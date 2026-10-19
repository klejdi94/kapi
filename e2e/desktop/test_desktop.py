"""
Drives the real kapi desktop binary through tauri-driver (WebDriver) — the
native webview, IPC, CSP, script sandbox, keychain and gRPC all for real.
Run via ./run.sh, which starts the servers, a virtual display and a keyring.
"""
import json
import os
import subprocess
import sys
import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.options import ArgOptions
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

APP = os.environ['KAPI_APP']
SHOTS = os.environ.get('SHOTS', 'e2e-desktop-shots')
os.makedirs(SHOTS, exist_ok=True)

opts = ArgOptions()
opts.set_capability('browserName', 'wry')
opts.set_capability('tauri:options', {'application': APP})
try:
    d = webdriver.Remote(command_executor='http://127.0.0.1:4444', options=opts)
except Exception as exc:  # noqa: BLE001
    if os.environ.get('GITHUB_ACTIONS'):
        print(f"::error title=desktop e2e::could not start a WebDriver session: {str(exc)[:800]}")
    raise
wait = WebDriverWait(d, 25)
failures = []


def check(name, condition, detail=''):
    print(f"{'✓' if condition else '✗'} {name}{'' if condition else f' — {detail}'}")
    if not condition:
        failures.append(name)
        annotate(f'{name} — {detail}')


def annotate(message):
    # Shows up as an annotation on the CI run, readable without downloading logs.
    if os.environ.get('GITHUB_ACTIONS'):
        print(f"::error title=desktop e2e::{str(message)[:900]}")


def clickable(xpath):
    return wait.until(EC.element_to_be_clickable((By.XPATH, xpath)))


def button(text):
    return clickable(f"//button[normalize-space(.)='{text}']")


def tab(text):
    return clickable(f"//*[@role='tab' and starts-with(normalize-space(.), '{text}')]")


def replace_editor(index, text):
    editor = d.find_elements(By.CSS_SELECTOR, '.cm-content')[index]
    editor.click()
    editor.send_keys(Keys.CONTROL, 'a')
    editor.send_keys(Keys.DELETE)
    editor.send_keys(text)


try:
    wait.until(EC.presence_of_element_located((By.XPATH, "//*[normalize-space(.)='Getting started']")))
    time.sleep(1)

    # --- webview hardening
    d.execute_script("const s=document.createElement('script'); s.textContent='window.__inline=1'; document.body.appendChild(s);")
    check('CSP blocks injected inline scripts', d.execute_script('return window.__inline === undefined'))
    key = d.execute_async_script("const done = arguments[0]; window.__TAURI_INTERNALS__.invoke('kapi_secrets_key').then(done, (e) => done('ERR ' + e));")
    check('secrets key comes from the OS keychain', isinstance(key, str) and len(key) == 64, key)

    # --- external secret references: consent is native and can't be skipped
    invoke = "const [cmd, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(cmd, args).then((v) => done({ ok: v }), (e) => done({ err: String(e) }));"
    approved = d.execute_async_script(invoke, 'kapi_resolve_secret_ref', {'reference': 'op://Private/API/token', 'purpose': 'e2e'})
    check('an allowed reference is read through the provider CLI', approved == {'ok': 's3cr3t-from-1password'}, approved)
    d.set_script_timeout(30)
    d.execute_script(
        "window.__denied = null; window.__TAURI_INTERNALS__.invoke('kapi_resolve_secret_ref', { reference: 'op://Private/Bank/password', purpose: 'e2e' })"
        ".then((v) => (window.__denied = { ok: v }), (e) => (window.__denied = { err: String(e) }));"
    )
    dialog_seen = False
    for _ in range(40):
        time.sleep(0.25)
        found = subprocess.run(['xdotool', 'search', '--name', 'Allow access to an external secret'], capture_output=True, text=True).stdout.split()
        if found:
            dialog_seen = True
            subprocess.run(['xdotool', 'windowfocus', '--sync', found[0], 'key', '--clearmodifiers', 'Escape'], capture_output=True)
            break
    check('an unknown reference opens a native consent dialog', dialog_seen)
    denied = None
    for _ in range(40):
        denied = d.execute_script('return window.__denied')
        if denied:
            break
        time.sleep(0.25)
    check('declining it refuses the lookup', bool(denied) and "wasn't allowed" in denied.get('err', ''), denied)
    approvals = d.execute_async_script(invoke, 'kapi_secret_ref_approvals', {})
    check('declining grants nothing', approvals == {'ok': ['op://Private/API/token']}, approvals)
    d.execute_async_script(invoke, 'kapi_secret_ref_revoke', {'reference': 'op://Private/API/token'})
    approvals = d.execute_async_script(invoke, 'kapi_secret_ref_approvals', {})
    check('an approval can be revoked', approvals == {'ok': []}, approvals)

    # --- HTTP with sandboxed scripts
    clickable("//*[normalize-space(.)='Untitled request']").click()
    url = wait.until(EC.presence_of_element_located((By.XPATH, "//input[contains(@placeholder, 'paste a cURL command')]")))
    url.send_keys(Keys.CONTROL, 'a')
    url.send_keys('http://127.0.0.1:18090/echo')
    tab('Scripts').click()
    tab('Pre-request').click()
    replace_editor(0, "pm.request.headers.add({ key: 'X-From-Script', value: 'yes' });")
    tab('Tests').click()
    replace_editor(
        0,
        "pm.test('header arrived', () => pm.expect(pm.response.json().headers['x-from-script']).to.equal('yes'));\n"
        "pm.test('no app access', () => pm.expect(typeof __TAURI_INTERNALS__).to.equal('undefined'));\n"
        "pm.test('status', () => pm.response.to.have.status(200));\n"
        "const _ = require('lodash'); const CryptoJS = require('crypto-js');\n"
        "pm.test('libraries', () => { pm.expect(_.sum([1, 2])).to.equal(3); pm.expect(CryptoJS.SHA256('kapi').toString()).to.have.lengthOf(64); });",
    )
    button('Send').click()
    wait.until(EC.presence_of_element_located((By.XPATH, "//*[normalize-space(.)='200 OK']")))
    # The response pane's Tests tab is the last one with that name (the first is the script editor's).
    clickable("(//*[@role='tab' and starts-with(normalize-space(.), 'Tests')])[last()]").click()
    wait.until(EC.presence_of_element_located((By.XPATH, "//*[normalize-space(.)='4/4']")))
    d.save_screenshot(f'{SHOTS}/http-scripts.png')
    check('pre-request script edits the request; tests and require()d libraries work in the sandbox', True)

    # --- secrets stay out of the files on disk
    tab('Auth').click()
    auth_type = wait.until(EC.presence_of_element_located((By.XPATH, "//select[option[@value='bearer']]")))
    for option in auth_type.find_elements(By.TAG_NAME, 'option'):
        if option.get_attribute('value') == 'bearer':
            option.click()
    token = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@placeholder='{{token}}']")))
    token.send_keys('e2e-super-secret-token')
    time.sleep(2.5)  # debounced saves
    data_dir = os.path.join(os.environ['XDG_DATA_HOME'], 'com.klejdi94.kapi')
    files = {name: open(os.path.join(data_dir, name)).read() for name in os.listdir(data_dir) if name.endswith('.json')}
    leaked = [name for name, text in files.items() if 'e2e-super-secret-token' in text]
    check('a typed token is saved only to the encrypted vault', not leaked and 'kapi.secrets.json' in files, f'leaked into {leaked}, files {sorted(files)}')

    # --- gRPC
    d.find_element(By.TAG_NAME, 'body').send_keys(Keys.CONTROL, 'k')
    time.sleep(0.4)
    d.switch_to.active_element.send_keys('New gRPC tab')
    time.sleep(0.3)
    d.switch_to.active_element.send_keys(Keys.ENTER)
    url = wait.until(EC.presence_of_element_located((By.XPATH, "//input[starts-with(@placeholder, 'localhost:50051')]")))
    url.send_keys(Keys.CONTROL, 'a')
    url.send_keys('127.0.0.1:50077')
    button('Server reflection').click()
    wait.until(EC.presence_of_element_located((By.XPATH, "//option[normalize-space(.)='demo.v1.Greeter']")))
    methods = [o.text for o in d.find_elements(By.XPATH, "//select[@aria-label='Method']/option")]
    check('reflection lists all four method kinds', len(methods) == 4, methods)

    replace_editor(0, '{"name": "kapi"}')
    button('Invoke').click()
    wait.until(EC.presence_of_element_located((By.XPATH, "//pre[contains(., 'Hello kapi')]")))
    check('unary call', True)

    for option in d.find_elements(By.XPATH, "//select[@aria-label='Method']/option"):
        if option.text.startswith('CountTo'):
            option.click()
    replace_editor(0, '{"n": 4}')
    button('Invoke').click()
    wait.until(EC.presence_of_element_located((By.XPATH, "//*[contains(., '4 messages')]")))
    check('server streaming delivers every message', len(d.find_elements(By.XPATH, "//pre[contains(., '\"n\"')]")) == 4)
    d.save_screenshot(f'{SHOTS}/grpc-stream.png')
    # --- realtime protocols
    def palette(command):
        d.find_element(By.TAG_NAME, 'body').send_keys(Keys.CONTROL, 'k')
        time.sleep(0.4)
        d.switch_to.active_element.send_keys(command)
        time.sleep(0.3)
        d.switch_to.active_element.send_keys(Keys.ENTER)
        time.sleep(0.5)

    def choose(select_label, value):
        select = wait.until(EC.presence_of_element_located((By.XPATH, f"//select[@aria-label='{select_label}']")))
        for option in select.find_elements(By.TAG_NAME, 'option'):
            if option.get_attribute('value') == value:
                option.click()

    def set_input(xpath, text):
        field = wait.until(EC.presence_of_element_located((By.XPATH, xpath)))
        field.send_keys(Keys.CONTROL, 'a')
        field.send_keys(text)

    def log_text():
        return d.find_element(By.TAG_NAME, 'body').text

    def wait_for_text(fragment, timeout=15):
        WebDriverWait(d, timeout).until(lambda _: fragment in log_text())

    # GraphQL subscription
    palette('New WebSocket tab')
    choose('Protocol', 'graphql')
    set_input("//input[starts-with(@placeholder, 'wss://api.example.com/graphql')]", 'ws://127.0.0.1:18085/graphql')
    tab('Subscription').click()
    replace_editor(0, 'subscription { countdown(from: 3) }')
    button('Subscribe').click()
    tab('Messages').click()
    wait_for_text('Subscription #1 completed')
    results = d.find_elements(By.XPATH, "//pre[contains(., '\"countdown\"')]")
    check('GraphQL subscription streams every result', len(results) == 4, [r.text for r in results])
    d.save_screenshot(f'{SHOTS}/graphql-subscription.png')

    # Socket.IO
    palette('New WebSocket tab')
    choose('Protocol', 'socketio')
    set_input("//input[@placeholder='http://localhost:3000']", 'http://127.0.0.1:18086')
    button('Connect').click()
    wait_for_text('Connected to /')
    set_input("//input[@aria-label='Event']", 'add')
    set_input("//input[@aria-label='Arguments']", '[20, 22]')
    clickable("//label[.//span[normalize-space(.)='Ack']]").click()
    button('Emit').click()
    wait_for_text('ack for add 42')
    check('Socket.IO connects, receives events and matches acks', 'welcome' in log_text())
    d.save_screenshot(f'{SHOTS}/socketio.png')

    # MQTT over TCP, then over WebSocket
    for broker in ['mqtt://127.0.0.1:18883', 'ws://127.0.0.1:18884/mqtt']:
        palette('New MQTT tab')
        set_input("//input[starts-with(@placeholder, 'mqtt://localhost:1883')]", broker)
        button('Connect').click()
        wait_for_text('Subscribed to #')
        set_input("//input[@aria-label='Publish topic']", 'kapi/e2e')
        set_input("//input[@aria-label='Payload']", '{"on": true}')
        button('Publish').click()
        WebDriverWait(d, 15).until(lambda _: len(d.find_elements(By.XPATH, "//span[normalize-space(.)='kapi/e2e']")) >= 2)
        check(f'MQTT publishes and receives over {broker.split(":")[0]}', True)
        d.save_screenshot(f'{SHOTS}/mqtt-{broker.split(":")[0]}.png')
        button('Disconnect').click()
except Exception as exc:  # noqa: BLE001 — report and screenshot whatever broke
    failures.append(f'exception: {exc!r}'[:300])
    print(failures[-1])
    annotate(f"{failures[-1]} at {d.current_url} — page text: {d.find_element(By.TAG_NAME, 'body').text[:500]!r}")
    d.save_screenshot(f'{SHOTS}/failure.png')
finally:
    d.quit()

print(json.dumps({'failures': failures}))
sys.exit(1 if failures else 0)
