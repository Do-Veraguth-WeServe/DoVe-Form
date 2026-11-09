// App-owned modal only: no guest HTML or native blocking browser dialogs.
let active = false;
function ask(message, inputMode) {
  // Fail closed on duplicate requests rather than queueing stale consent.
  if (active) return Promise.resolve(inputMode ? null : false);
  active = true;
  return new Promise(resolve => {
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'app-question';
    dialog.setAttribute('aria-label', inputMode ? 'Eingabe' : 'Bestätigung');
    const form = document.createElement('form'); form.className = 'dlg';
    const title = document.createElement('strong'); title.textContent = inputMode ? 'Eingabe' : 'Bestätigung';
    const messageNode = document.createElement('p'); messageNode.id = 'app-question-message';
    messageNode.textContent = String(message); messageNode.style.whiteSpace = 'pre-wrap';
    messageNode.style.overflowWrap = 'anywhere';
    dialog.setAttribute('aria-describedby', messageNode.id);
    form.append(title, messageNode);
    let input;
    if (inputMode) {
      input = document.createElement('input'); input.type = 'text'; input.maxLength = 32;
      input.autocomplete = 'off'; input.required = true; input.setAttribute('aria-label', 'Benutzername');
      form.append(input);
    }
    const actions = document.createElement('div'); actions.className = 'row-actions'; actions.style.marginTop = '20px';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Abbrechen';
    const accept = document.createElement('button'); accept.type = 'submit'; accept.textContent = inputMode ? 'Weiter' : 'Bestätigen';
    actions.append(cancel, accept); form.append(actions); dialog.append(form);
    dialog.style.maxHeight = '85dvh'; dialog.style.overflowY = 'auto';
    let settled = false;
    function finish(value) {
      if (settled) return; settled = true;
      dialog.close(); dialog.remove(); active = false;
      if (previous?.isConnected) previous.focus({preventScroll:true});
      resolve(value);
    }
    cancel.onclick = () => finish(inputMode ? null : false);
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(inputMode ? null : false); });
    dialog.addEventListener('close', () => finish(inputMode ? null : false));
    // Do not let Escape close the underlying sidebar/parent modal as well.
    dialog.addEventListener('keydown', e => e.stopPropagation());
    form.onsubmit = e => { e.preventDefault(); if(input && !input.value.trim()) return; finish(input ? input.value.trim() : true); };
    document.body.append(dialog);
    try { dialog.showModal(); (input || cancel).focus(); }
    catch { finish(inputMode ? null : false); }
  });
}
export const confirmAction = message => ask(message, false);
export const promptRecipient = message => ask(message, true);
