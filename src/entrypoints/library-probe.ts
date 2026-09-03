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
  try {
    const children = scope.gsap?.globalTimeline?.getChildren?.(true, true, false);
    // Zero-duration tweens are GSAP's own bookkeeping, not page motion.
    gsapTweens = Array.isArray(children)
      ? children.filter((tween) => {
          const duration = (tween as { duration?: () => number }).duration?.();
          return typeof duration === 'number' && duration > 0;
        }).length
      : 0;
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
  };
});
