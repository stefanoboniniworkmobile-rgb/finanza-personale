# Setup Resend per la produzione

Questa guida copre la configurazione di Resend come provider SMTP per le email
transazionali di Finanza Personale (magic link di login + conferma cambio email).

In sviluppo, Resend **non serve**: con `RESEND_API_KEY` vuota, il link viene
stampato in console e basta copiarlo. Configura Resend solo quando vai in prod.

## Cosa serve

- Dominio web di proprietà (es. `finanza-personale.app`) con accesso al DNS
- Account Resend (gratis fino a 3.000 email/mese)
- ~30 minuti di tempo (la propagazione DNS può richiedere fino a 24h)

## Step 1 — Registrazione account

1. Vai su https://resend.com e clicca **Sign up**
2. Usa la stessa email con cui amministri il dominio
3. Verifica l'email di conferma

## Step 2 — Verifica del dominio

Resend richiede di verificare il dominio mittente prima di poter spedire da
indirizzi tipo `noreply@tuo-dominio.app`. Senza verifica, le email finiscono
in spam (e dopo qualche tempo Resend ti blocca).

1. Su Resend → **Domains** → **Add Domain**
2. Inserisci il dominio nudo (es. `finanza-personale.app`, senza `www.`)
3. Resend mostra una lista di **record DNS** da aggiungere:

   - **SPF** (`TXT` su `@`): autorizza Resend a spedire per conto tuo
     ```
     v=spf1 include:_spf.resend.com ~all
     ```
     ⚠ Se hai già un record SPF per altri servizi (Google Workspace, ecc.),
     devi **unirli in un solo record**, non duplicarli. Esempio:
     ```
     v=spf1 include:_spf.google.com include:_spf.resend.com ~all
     ```

   - **DKIM** (`CNAME` o `TXT`): firma crittografica delle email. Resend genera
     una stringa specifica per il tuo dominio. Copia-incolla esatto.

   - **MX** opzionale: solo se vuoi ricevere email su quel dominio (per noi non
     serve, mandiamo solo).

4. Vai sul registrar del dominio (Cloudflare, Namecheap, Aruba, ecc.) e
   aggiungi i record nella zona DNS
5. Torna su Resend e clicca **Verify**. Se il DNS non si è ancora propagato,
   riprova dopo 10-30 minuti. Per Cloudflare la propagazione è quasi istantanea.

### DMARC (consigliato ma opzionale)

DMARC dice ai server riceventi cosa fare quando un'email che dice di venire dal
tuo dominio fallisce SPF/DKIM. Senza DMARC, le grandi piattaforme (Gmail,
Outlook) possono comunque consegnare ma con score più basso.

Aggiungi un record `TXT` su `_dmarc.tuo-dominio.app`:
```
v=DMARC1; p=quarantine; rua=mailto:postmaster@tuo-dominio.app
```

`p=quarantine` mette in spam le email sospette. Puoi iniziare con `p=none`
(solo monitoraggio) e passare a `quarantine` dopo qualche giorno se non ci
sono falsi positivi.

## Step 3 — Generazione API key

1. Su Resend → **API Keys** → **Create API Key**
2. Name: "Finanza Personale prod"
3. Permission: **Sending access** (non Full, per limitare il blast radius in
   caso di leak)
4. Domain: scegli il dominio appena verificato (così la key non può spedire da
   altri domini Resend)
5. Crea e **copia subito** la key — non viene mostrata di nuovo

## Step 4 — Configurazione env di produzione

Sul tuo hosting (Vercel, Railway, fly.io, ecc.) imposta queste variabili
d'ambiente:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Finanza Personale <noreply@tuo-dominio.app>
```

⚠ `EMAIL_FROM` deve usare un indirizzo del dominio verificato. Se metti
un'email Gmail/Yahoo, Resend rifiuta lo spedire.

**Vercel**: dashboard → Settings → Environment Variables → aggiungi le due
chiavi, Environment "Production" + "Preview", clicca Save.

## Step 5 — Verifica spedizione

Dopo il deploy con le env settate:

1. Apri la webapp in prod
2. Vai su `/login`, inserisci una tua email reale
3. Controlla la casella: dovresti ricevere il magic link entro 10 secondi
4. Se non arriva, controlla la cartella Spam
5. Su Resend → **Logs** vedi tutte le email spedite con stato (Delivered,
   Bounced, ecc.). Se vedi Bounced, l'indirizzo destinatario non esiste o ha
   rifiutato. Se non vedi niente, l'app non sta chiamando Resend (controlla
   `RESEND_API_KEY` in env).

## Limiti free tier

- 3.000 email/mese
- 100 email/giorno
- 1 dominio verificato
- 7 giorni di log retention

Per uso personale (te + qualche amico) il free tier basta. Quando arriverai
a circa 100 utenti attivi che si loggano una volta a settimana → ~400 email
mensili (con session lunghe 90gg ne servono pochissime per utente), sei
ancora dentro.

Soglia di passaggio a piano a pagamento ($20/mese, 50.000 email):
- ~10.000 utenti attivi mensili
- Oppure se vuoi più di 1 dominio (es. per /staging)

## Alternative a Resend

Se per qualche motivo Resend non va, sono drop-in compatible via SMTP:

| Provider | Free tier | Note |
|---|---|---|
| Resend | 3.000/mese | Più semplice da configurare. Preferito. |
| Postmark | 100/mese | Ottima deliverability ma free tier piccolo. |
| SendGrid | 100/giorno | Più complesso, owner Twilio. |
| AWS SES | $0.10 per 1.000 | Complicato da setup (verificare dominio + uscire da sandbox). Economico al volume. |
| Mailgun | 100/giorno (5 giorni free trial) | Buono per developer, pricing aggressivo dopo trial. |

Per cambiare provider, basta sostituire `host`/`port`/`auth` in
`src/lib/email-send.ts`.

## Troubleshooting

**"Domain not verified"** quando Resend rifiuta lo spedire
→ controlla che il DNS sia propagato (`dig TXT tuo-dominio.app`), poi su
Resend → Domains clicca Verify di nuovo.

**Email finisce in spam su Gmail/Outlook**
→ probabilmente manca DKIM o SPF non è propagato. Tool utile:
https://www.mail-tester.com — manda un'email a un indirizzo lì generato,
torna sul sito e leggi il report.

**Errore "Authentication failed" da nodemailer**
→ controlla che `RESEND_API_KEY` sia popolata in env di produzione.
La key inizia con `re_`. Non confonderla con altre key Resend (Webhook
secret, ecc.).

**Email duplicata o doppia consegna**
→ Resend tiene un rate limit interno; se la nostra webapp lo chiama due
volte per la stessa richiesta (es. doppio submit form), Resend dedupe.
Se vedi doppi nei log, è bug client-side (form submit racing).
