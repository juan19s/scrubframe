import { describeOne } from './describe';
import type { AnimatedCandidate, AnimationCensus } from '../shared/probe';

/**
 * Counts what is animating, and where.
 *
 * Runs in the ISOLATED world. That works because getAnimations() carries no
 * [CallWith=ScriptState] in Blink's IDL — the C++ is never told which world
 * asked, so it cannot filter by one — and it is better than the MAIN world for
 * a read-only census: a page that has monkey-patched Array.prototype or
 * Animation.prototype cannot poison a probe reading through its own prototypes.
 *
 * It costs the page nothing. No attach, no banner, no DOM mutation.
 */
export function takeCensus(): AnimationCensus {
  const seen = new Set<Animation>();
  let shadowRoots = 0;

  for (const animation of document.getAnimations()) seen.add(animation);

  // getAnimations() is scoped to a tree scope and never crosses a shadow
  // boundary, so open roots are walked by hand — the same way the picker's
  // marker lookup does it, which keeps both ends agreeing about what exists.
  const walk = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll('*')) {
      const shadow = (element as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
      if (!shadow) continue;
      shadowRoots += 1;
      for (const animation of shadow.getAnimations()) seen.add(animation);
      walk(shadow);
    }
  };
  walk(document);

  const candidates: AnimatedCandidate[] = [];
  let transitions = 0;

  for (const animation of seen) {
    const kind = animation.constructor?.name ?? 'Animation';
    if (kind === 'CSSTransition') transitions += 1;

    const effect = animation.effect;
    const target = effect && 'target' in effect ? (effect as KeyframeEffect).target : null;
    if (!target) continue;

    const rect = target.getBoundingClientRect();
    // A zero-size box cannot be highlighted and cannot be captured. Measured:
    // element.animate() on a display:none node stays "running" and reports
    // 0x0, so this is a real case rather than a defensive flourish.
    if (rect.width < 1 || rect.height < 1) continue;

    const timing = effect?.getComputedTiming?.();
    const duration = typeof timing?.duration === 'number' ? timing.duration : null;
    const pseudo = (effect as KeyframeEffect | null)?.pseudoElement ?? null;

    candidates.push({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      label: describeOne(target) + (pseudo ?? ''),
      driver:
        (animation as Animation & { animationName?: string }).animationName ??
        (animation as Animation & { transitionProperty?: string }).transitionProperty ??
        'script',
      kind: 'waapi',
      durationMs: duration,
    });
  }

  // SMIL is invisible to the whole Web Animations API — not merely absent from
  // getAnimations(), but unreachable by it. Nothing can freeze it, so it keeps
  // moving through every frame of a capture. Counting it is the only way to
  // warn about frames that will look right and be wrong.
  const smilNodes = document.querySelectorAll('animate, animateTransform, animateMotion, set');
  for (const node of smilNodes) {
    const owner = node.closest('svg') ?? node.parentElement;
    if (!owner) continue;
    const rect = owner.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    candidates.push({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      label: describeOne(owner),
      driver: `SMIL <${node.tagName}>`,
      kind: 'smil',
      durationMs: null,
    });
  }

  return {
    waapiTotal: seen.size,
    transitions,
    smil: smilNodes.length,
    candidates,
    shadowRoots,
  };
}
