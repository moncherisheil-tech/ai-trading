import paramiko
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('88.99.208.99', username='root', password='taLai8f5W?7P38', allow_agent=False, look_for_keys=False)

cmds = [
    'ls -la /root/images/',
    'ls -la /root/configs/',
    'ls /root/.oldroot/nfs/install/configs/ 2>/dev/null | head -10',
    'cat /root/.oldroot/nfs/install/configs/UK_Ubuntu-2404-noble-amd64-base.conf 2>/dev/null || cat /root/.oldroot/nfs/install/configs/Ubuntu-2404-noble-amd64-base.conf 2>/dev/null || ls /root/.oldroot/nfs/install/configs/ 2>/dev/null | grep -i ubuntu',
    '/root/.oldroot/nfs/install/installimage --help 2>&1 | head -30',
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
