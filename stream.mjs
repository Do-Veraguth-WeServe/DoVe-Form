// Incremental two-phase stream parser.
// Relays prose as it arrives, detects exactly one fenced ```json artifact.
// Robust against markers split across chunk boundaries.
const OPEN = '```json';
const CLOSE = '\n```';

export function createStreamParser({onProse, onArtifactStart} = {}) {
  let mode = 'prose';        // prose | artifact | done
  let hold = '';             // prose holdback (possible partial marker)
  let artifact = '';
  let started = false;       // onArtifactStart fired

  const emit = t => { if (t) onProse?.(t); };

  const artifactFeed = t => {
    artifact += t;
    const j = artifact.indexOf(CLOSE);
    if (j !== -1) { artifact = artifact.slice(0, j); mode = 'done'; }
  };

  const feed = text => {
    if (typeof text !== 'string' || mode === 'done') return;
    if (mode === 'prose') {
      hold += text;
      const i = hold.indexOf(OPEN);
      if (i !== -1) {
        emit(hold.slice(0, i));
        const rest = hold.slice(i + OPEN.length);
        hold = '';
        mode = 'artifact'; started = true;
        onArtifactStart?.();
        if (rest) artifactFeed(rest);
        return;
      }
      // Flush everything except a possible partial-marker suffix.
      let keep = 0;
      for (let k = Math.min(hold.length, OPEN.length - 1); k > 0; k--) {
        if (hold.endsWith(OPEN.slice(0, k))) { keep = k; break; }
      }
      const flushLen = hold.length - keep;
      if (flushLen > 0) { emit(hold.slice(0, flushLen)); hold = hold.slice(flushLen); }
      return;
    }
    artifactFeed(text);
  };

  const finish = () => {
    if (mode === 'prose') {
      emit(hold); hold = ''; mode = 'done';
      return { hadArtifact: false, artifactRaw: null };
    }
    mode = 'done';
    const raw = artifact.replace(/^\n/, '').replace(/```\s*$/, '').trim();
    return { hadArtifact: started, artifactRaw: raw };
  };

  return { feed, finish };
}
