# Server Analysis — GitHub Secrets Reference

This file tells DevOps what secrets to configure in the GitHub repository for the CI/CD pipeline to work.

## How to Add Secrets

GitHub → Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

---

## Required Secrets

| Secret Name | Value | Where to get it |
|---|---|---|
| `PROD_SERVER_HOST` | IP or hostname of the production server | Server dashboard / control panel |
| `PROD_SERVER_USER` | SSH username (e.g. `devops`, `ubuntu`, `root`) | System administrator |
| `PROD_SSH_PRIVATE_KEY` | Contents of the SSH private key file | `cat ~/.ssh/id_rsa` on your local machine |

---

## Example: Generating an SSH Key Pair for CI/CD

If a dedicated deploy key doesn't already exist, generate one on the production server:

```bash
# On the production server
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_key -N ""

# Authorize the public key to log in
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Print the private key — paste this into GitHub Secret: PROD_SSH_PRIVATE_KEY
cat ~/.ssh/deploy_key
```

> **Security**: Never commit the private key to the repository.

---

## Optional Secrets (for alert notifications)

| Secret Name | Description |
|---|---|
| `SMTP_HOST` | Email server host |
| `SMTP_PORT` | Email server port (usually 587) |
| `SMTP_USER` | Email username |
| `SMTP_PASS` | Email password |
| `ALERT_EMAIL_RECIPIENT` | Who receives alert emails |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL |
