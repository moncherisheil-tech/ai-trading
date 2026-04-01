import paramiko
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('88.99.208.99', username='root', password='taLai8f5W?7P38', allow_agent=False, look_for_keys=False)

cmds = [
    'which installimage 2>/dev/null || echo NOT_IN_PATH',
    'find / -maxdepth 6 -name installimage -type f 2>/dev/null | head -10',
    'ls /root/',
    'echo $PATH',
    'ls /usr/local/bin/ 2>/dev/null',
    'ls /root/.oldroot/nfs/install/ 2>/dev/null | head -20',
    'cat /etc/os-release 2>/dev/null | head -5',
]
for c in cmds:
    stdin, stdout, stderr = client.exec_command(c, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(f'=== CMD: {c}')
    print(f'OUT: {out}')
    if err.strip():
        print(f'ERR: {err}')
    print()
client.close()
