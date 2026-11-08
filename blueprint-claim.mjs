// Consistency guard for generated claims, not a classifier of user intent.
export function claimsBlueprintUpdate(text){
 return String(text||'').split(/[.!?\n]/).some(s=>/\b(?:blueprint|plan(?:ung)?)\b/i.test(s)&&!/(?:nicht|keine)\s+(?:\w+\s+){0,3}(?:aktualisier|aufgenommen|ergänz|angepasst|eingetragen|übernommen)|not\s+(?:yet\s+)?updated/i.test(s)&&/(?:aktualisier|aufgenommen|ergänz|angepasst|eingetragen|übernommen|trage.{0,100}(?:ein|plan)|nehme.{0,100}(?:auf|plan)|updated|added.{0,80}(?:plan|blueprint)|incorporat)/i.test(s));
}
