/**
 * MAIN world, and only because it has to be.
 *
 * Animation libraries announce themselves through JS globals, and globals are
 * exactly what an isolated world does not share. window.gsap is invisible from
 * the census's world no matter how much DOM they have in common — which is why
 * this is a second, separate injection rather than one probe doing both.
 *
 * Read-only: it touches nothing, so a page that tampers with its own prototypes
 * can lie to it, and the worst outcome is a wrong recommendation rather than a
 * wrong capture.
 */
export default defineUnlistedScript(() => {
  const scope = globalThis as Record<string, unknown> & {
    gsap?: { globalTimeline?: { getChildren?: (...args: unknown[]) => unknown[] } };
  };

  let gsapTweens = 0;
  /**
   * GSAP's targets, with boxes.
   *
   * The census cannot produce these: it runs in the isolated world, where
   * window.gsap does not exist. Without them the panel can say "use GSAP" and
   * not say on what — which is the same dead end the probe was built to end.
   */
  const candidates: Array<Record<string, unknown>> = [];
  const seen = new Set<Element>();

  try {
    const children = scope.gsap?.globalTimeline?.getChildren?.(true, true, false);
    const live = Array.isArray(children)
      ? children.filter((tween) => {
          // Zero-duration tweens are GSAP's own bookkeeping, not page motion.
          const duration = (tween as { duration?: () => number }).duration?.();
          return typeof duration === 'number' && duration > 0;
        })
      : [];
    gsapTweens = live.length;

    for (const tween of live) {
      const item = tween as {
        targets?: () => unknown[];
        duration?: () => number;
        vars?: Record<string, unknown>;
      };
      const scrollDriven = Boolean(item.vars?.scrollTrigger);
      for (const raw of item.targets?.() ?? []) {
        const target = raw as Element;
        if (!target || (target as Node).nodeType !== 1 || seen.has(target)) continue;
        seen.add(target);
        const rect = target.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const classes = String(
          (target as HTMLElement).className ??
            (target as unknown as { className?: { baseVal?: string } }).className?.baseVal ??
            '',
        )
          .split(' ')
          .filter(Boolean)
          .slice(0, 2);
        candidates.push({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          label: target.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : ''),
          // Naming the driver is what tells the user which adapter it belongs
          // to: ScrollTrigger tweens follow scroll, not a clock.
          driver: scrollDriven ? 'GSAP + ScrollTrigger' : 'GSAP',
          kind: scrollDriven ? 'gsap-scroll' : 'gsap',
          durationMs: Math.round((item.duration?.() ?? 0) * 1000),
        });
      }
    }
  } catch {
    // A GSAP old enough not to have getChildren still counts as present.
  }

  return {
    gsap: typeof scope.gsap === 'object' && scope.gsap !== null,
    gsapTweens,
    scrollTrigger: typeof scope.ScrollTrigger !== 'undefined',
    lottie: typeof scope.lottie !== 'undefined',
    lenis:
      typeof scope.Lenis !== 'undefined' ||
      document.documentElement.classList.contains('lenis'),
    motionOne: typeof scope.Motion !== 'undefined',
    waapiTotal: document.getAnimations().length,
    candidates,
  };
});
