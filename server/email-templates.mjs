import { InputError } from './store.mjs'

const footer = 'Heb je deze e-mail niet aangevraagd? Dan kun je hem negeren.'
const defaults = {
  register: { name: 'Account bevestigen', subject: 'Bevestig je account bij Aan tafel', heading: 'Welkom aan tafel', body: 'Hoi {naam},\n\nBevestig je e-mailadres en kies een wachtwoord om samen je maaltijden te plannen.\n\nDeze link is {geldigheid} geldig.', button: 'Account bevestigen', footer },
  invite: { name: 'Uitnodiging voor een groep', subject: 'Je bent uitgenodigd voor {groep}', heading: 'Schuif aan bij {groep}', body: 'Je bent uitgenodigd voor de groep {groep}. Maak je account aan om samen te plannen en boodschappen af te vinken.\n\nDeze link is {geldigheid} geldig.', button: 'Uitnodiging accepteren', footer },
  reset: { name: 'Wachtwoord herstellen', subject: 'Kies een nieuw wachtwoord voor Aan tafel', heading: 'Een nieuw wachtwoord', body: 'Via de knop hieronder kies je een nieuw wachtwoord voor je account.\n\nDeze link is {geldigheid} geldig en kan één keer worden gebruikt.', button: 'Wachtwoord herstellen', footer },
  superuser: { name: 'Uitnodiging voor beheer', subject: 'Uitnodiging voor Aan tafel-beheer', heading: 'Help Aan tafel beheren', body: 'Je bent uitgenodigd als superuser. Accepteer de uitnodiging met je bestaande wachtwoord.\n\nDeze link is {geldigheid} geldig.', button: 'Beheeruitnodiging accepteren', footer },
}
const fields = { subject: 200, heading: 160, body: 4000, button: 80, footer: 800 }
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
function validate(kind, value) {
  if (!Object.hasOwn(defaults, kind) || !value || typeof value !== 'object') throw new InputError('Ongeldig mailsjabloon.')
  const result = {}
  for (const [field, limit] of Object.entries(fields)) {
    const text = value[field]
    if (typeof text !== 'string' || !text.trim() || text.length > limit ||
        (field === 'subject' && /[\r\n]/.test(text)) ||
        [...text.matchAll(/\{([^{}]+)\}/g)].some(match => !['naam', 'groep', 'geldigheid'].includes(match[1]))) {
      throw new InputError('Controleer de tekst van ' + field + '. Gebruik alleen {naam}, {groep} en {geldigheid}.')
    }
    result[field] = text.trim()
  }
  return result
}

export function renderEmail(template, context, url) {
  const content = Object.fromEntries(Object.keys(fields).map(field => [field,
    template[field].replace(/\{(naam|groep|geldigheid)\}/g, (_, key) => context[key] ?? '')]))
  const paragraphs = value => value.split(/\n\s*\n/).map(part => '<p style="margin:0 0 20px;line-height:1.65;">' + escape(part).replace(/\n/g, '<br>') + '</p>').join('')
  const link = escape(url)
  return {
    subject: content.subject,
    text: 'Aan tafel\n\n' + content.heading + '\n\n' + content.body + '\n\n' + content.button + '\n' + url + '\n\n' + content.footer,
    html: '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(content.subject) + '</title></head>' +
      '<body style="margin:0;padding:0;background-color:#f7f6f0;color:#212c24;font-family:Arial,Helvetica,sans-serif;">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f7f6f0"><tr><td align="center" style="padding:32px 16px;">' +
      '<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">' +
      '<tr><td bgcolor="#274b35" style="padding:26px 28px;color:#ffffff;font-family:Georgia,serif;font-size:32px;font-weight:bold;">Aan tafel<span style="color:#dce5b8;">.</span></td></tr>' +
      '<tr><td bgcolor="#fffefa" style="padding:32px 28px;font-size:16px;">' +
      '<h1 style="margin:0 0 24px;color:#274b35;font-family:Georgia,serif;font-size:30px;line-height:1.2;">' + escape(content.heading) + '</h1>' +
      paragraphs(content.body) +
      '<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#274b35" style="border-radius:8px;mso-padding-alt:16px 24px;">' +
      '<a href="' + link + '" style="display:inline-block;padding:16px 24px;color:#ffffff;text-decoration:none;font-weight:bold;line-height:1.3;">' + escape(content.button) + '</a></td></tr></table>' +
      '<p style="margin:24px 0 8px;color:#59675c;font-size:13px;line-height:1.6;">Werkt de knop niet? Kopieer deze link naar je browser.</p>' +
      '<p style="margin:0;word-break:break-all;font-size:13px;line-height:1.6;"><a style="color:#274b35;" href="' + link + '">' + link + '</a></p></td></tr>' +
      '<tr><td style="padding:24px 28px;color:#59675c;font-size:13px;line-height:1.6;">' + paragraphs(content.footer) + '</td></tr></table>' +
      '<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>',
  }
}

export function createEmailTemplates(db) {
  db.exec('CREATE TABLE IF NOT EXISTS email_templates (kind TEXT NOT NULL, locale TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, locale))')
  function get(kind) {
    if (!Object.hasOwn(defaults, kind)) throw new InputError('Onbekend mailsjabloon.')
    const saved = db.prepare("SELECT data FROM email_templates WHERE kind = ? AND locale = 'nl'").get(kind)
    return { ...defaults[kind], ...(saved ? JSON.parse(saved.data) : {}) }
  }
  return {
    list: () => Object.keys(defaults).map(kind => ({ kind, ...get(kind) })),
    save(kind, draft) {
      const template = validate(kind, draft)
      db.prepare("INSERT INTO email_templates VALUES (?, 'nl', ?) ON CONFLICT(kind, locale) DO UPDATE SET data = excluded.data").run(kind, JSON.stringify(template))
      return { message: 'Mailteksten opgeslagen.' }
    },
    render(kind, context, url) { return renderEmail(get(kind), context, url) },
    preview(kind, draft) {
      return renderEmail(validate(kind, draft), { naam: 'Anne', groep: 'Letterie', geldigheid: kind === 'reset' ? '1 uur' : kind === 'invite' ? '7 dagen' : '24 uur' }, 'https://foodplan.example/#voorbeeld')
    },
  }
}
