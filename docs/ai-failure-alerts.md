# AI failure email alerts

Failed system generation, wiring, and design iteration requests trigger an
email independently of database logging. Email failures are reported in the
service journal and do not interrupt the user's request.

Configure these variables in `/usr/local/victron/.env`:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=VictronDesigner <alerts@your-verified-domain.com>
AI_ALERT_EMAIL=megaman5@gmail.com
```

Use port 465 with `SMTP_SECURE=true` for implicit TLS, or port 587 with
STARTTLS. Authentication is optional for a trusted local relay. The sender
must be allowed by your mail provider. The recipient defaults to the current
admin email when `AI_ALERT_EMAIL` is absent.

For [Resend](https://resend.com/docs/send-with-smtp), create an API key and
verify a sending domain, then use these settings:

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASSWORD=your-resend-api-key
SMTP_FROM=VictronDesigner <alerts@victrondesigner.com>
AI_ALERT_EMAIL=megaman5@gmail.com
```

The sender domain must match the domain verified in Resend. Keep the API key
in the protected `.env` file rather than source control or chat.

Identical failures for the same feature and model send at most one email
every 15 minutes per server process. A failed delivery can be retried on the
next failed AI request. Restarting the app resets this cooldown. Alerts contain
the feature, model, error, timestamp, and admin page link; they omit user
prompts and design data. SMTP acceptance confirms handoff, not inbox delivery.

After configuration or code changes, build and restart:

```sh
npm run build
sudo systemctl restart victron-designer.service
```

Gemini HTTP 402 means its prepaid balance is exhausted. Add credits in
[Google AI Studio](https://aistudio.google.com/projects). Consider enabling
auto-reload there to prevent another interruption:
[Google's billing guide](https://ai.google.dev/gemini-api/docs/billing#prepay).
