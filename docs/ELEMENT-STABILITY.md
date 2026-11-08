# Element stability — #11c2987f

Bounded first repair: the jobs SSE snapshot handler previously destroyed all feed iframes/QuickJS Workers for any nonempty snapshot, including unchanged jobs and jobs belonging to another conversation. Isolated Chromium reproduces iframe replacement before the patch (desktop assertion stops the baseline run). The post-fix suite covers desktop/mobile frame identity and preservation of unpersisted input.

Exact repeated job snapshots are now ignored; changed jobs from another conversation update the job map without rebuilding the current feed. Current-conversation changes and missing-active-job recovery still reconcile normally. This changes no artifact, guest permissions, persistence, sharing or job cancellation behavior.

`test/snapshot-stability.test.mjs` checks frame identity and local input across background, repeated, terminal and empty snapshots; repeated current jobs preserve identity, changed current jobs still render. Events are injected only into the trusted test page EventSource fixture, not through a guest frame.

This is not a complete resolution of all reported flicker. Real feed changes still rebuild frames; login/server recovery and full render lifecycle need further investigation. No claim of universal no-remount rendering or physical-device certification. Ticket remains working.

Source gates: deterministic baseline failure, patched desktop/mobile snapshot regression, navigation jobs, session entry and mobile momentum passed. Full Blueprint gate and deployment verification recorded below when complete. Prior unrelated npm-test failures remain backlog.
