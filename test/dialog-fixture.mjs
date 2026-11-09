export async function answerDialog(page, value=true) {
 const dialog=page.locator('dialog.app-question'); await dialog.waitFor();
 if(typeof value==='string')await dialog.getByRole('textbox').fill(value);
 await dialog.getByRole('button',{name:value===false?'Abbrechen':typeof value==='string'?'Weiter':'Bestätigen',exact:true}).click();
 await dialog.waitFor({state:'detached'});
}
