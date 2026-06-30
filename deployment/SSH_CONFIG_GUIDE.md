# SSH Credentials & Key-Based Authentication Config Guide

This guide explains how to set up key-based SSH access and configure the `SSH_USER` and `SSH_KEY_PATH` environment variables so the `ssh-collector` can pull metrics directly from target servers without password prompts.

---

## Step 1: Generate an SSH Keypair (If not already created)
On the **Server Analysis Dashboard Server** (where PM2 is running), check if you already have an SSH key. If not, generate a new one:

```bash
# Generate a new 4096-bit RSA keypair (press Enter to accept default path and empty passphrase)
ssh-keygen -t rsa -b 4096 -C "server-analysis-collector"
```
This generates:
*   Private key: `~/.ssh/id_rsa`
*   Public key: `~/.ssh/id_rsa.pub`

---

## Step 2: Copy the Public Key to Target Servers
The dashboard server must be authorized to log in to target servers. Copy your public key to **each target server**:

```bash
# Format: ssh-copy-id -i [path_to_pub_key] [user]@[target_server_ip]
# Example:
ssh-copy-id -i ~/.ssh/id_rsa.pub root@180.187.54.31
ssh-copy-id -i ~/.ssh/id_rsa.pub root@180.187.54.44
```
*(If `ssh-copy-id` is not available, append the contents of your `~/.ssh/id_rsa.pub` to the target server's `~/.ssh/authorized_keys` file manually.)*

---

## Step 3: Test Passwordless Connection
Verify that you can connect from the dashboard server to each target server **without being prompted for a password**:

```bash
# Format: ssh -i [path_to_private_key] [user]@[target_server_ip]
# Example:
ssh -i ~/.ssh/id_rsa root@180.187.54.31 "nproc"
```
If it returns the CPU core count (e.g. `4`) directly without asking for a password, connection is successful.

---

## Step 4: Configure the Environment Variables
Open the `.env` configuration file in your project directory:

```bash
nano /var/dev/server-analysis/.env
```

Add or update the following variables:

```env
# The user to log in to target servers (usually root or a user with read permissions)
SSH_USER=root

# The absolute path to the private SSH key file on the dashboard server
SSH_KEY_PATH=/root/.ssh/id_rsa
```

Save the file (`Ctrl+O`, `Enter`, then `Ctrl+X`).

---

## Step 5: Start or Restart the Collector
Restart the PM2 processes to load the new environment variables:

```bash
cd /var/dev/server-analysis
# If already running, reload the SSH collector
pm2 reload server-analysis-ssh-collector
# If not running, start it
pm2 start ssh-collector.js --name "server-analysis-ssh-collector"
pm2 save
```

Check the logs to verify connections are succeeding:
```bash
pm2 logs server-analysis-ssh-collector
```
You should see:
```text
[SSH Success] in31 | CPU: 12.5% | RAM: 45.0% | Load: 0.50
```
If SSH fails for any server, it will automatically log a warning and fall back to fetching data from Nagios.
