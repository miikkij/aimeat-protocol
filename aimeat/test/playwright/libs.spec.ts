import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ───

const TS = Date.now();
const USERNAME = `pw-${TS}`;
const PASSWORD = 'testpass42';

/** Wait for AIMEAT libraries to load on the test harness page. */
async function loadHarness(page: Page) {
    await page.goto('/v1/libs/test-harness');
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 10_000 });
}

/** Register a new user via AIMEAT.auth.register() in the browser and return session info. */
async function registerUser(page: Page, username: string, password: string) {
    return page.evaluate(
        ([u, p]) => (window as any).AIMEAT.auth.register(u, u, { password: p }),
        [username, password] as const,
    );
}

// ═══════════════════════════════════════════════════════
// 1. Library Loading
// ═══════════════════════════════════════════════════════

test.describe('Library Loading', () => {
    test('all 6 libraries load on the test harness page', async ({ page }) => {
        await loadHarness(page);

        const libs = await page.evaluate(() => ({
            auth: typeof (window as any).AIMEAT.auth,
            data: typeof (window as any).AIMEAT.data,
            storage: typeof (window as any).AIMEAT.storage,
            social: typeof (window as any).AIMEAT.social,
            wallet: typeof (window as any).AIMEAT.wallet,
            work: typeof (window as any).AIMEAT.work,
        }));

        expect(libs.auth).toBe('object');
        expect(libs.data).toBe('object');
        expect(libs.storage).toBe('object');
        expect(libs.social).toBe('object');
        expect(libs.wallet).toBe('object');
        expect(libs.work).toBe('object');
    });

    test('AIMEAT.version is set', async ({ page }) => {
        await loadHarness(page);
        const version = await page.evaluate(() => (window as any).AIMEAT.version);
        expect(typeof version).toBe('string');
        expect(version.length).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════
// 2. Auth Library (aimeat-auth.js)
// ═══════════════════════════════════════════════════════

test.describe('aimeat-auth', () => {
    test('register creates session with jwt, gaii, owner', async ({ page }) => {
        await loadHarness(page);
        const session = await registerUser(page, USERNAME, PASSWORD);
        expect(session).toBeTruthy();
        expect(typeof session.jwt).toBe('string');
        expect(session.jwt.length).toBeGreaterThan(0);
        expect(session.owner).toBe(USERNAME);
        expect(session.gaii).toContain('app#');
        expect(session.ghii).toContain(USERNAME);
    });

    test('login restores session from localStorage', async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-login-${TS}`, PASSWORD);

        // login() should restore from localStorage
        const session = await page.evaluate(() => (window as any).AIMEAT.auth.login());
        expect(session).toBeTruthy();
        expect(typeof session.jwt).toBe('string');
    });

    test('logout clears session', async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-logout-${TS}`, PASSWORD);

        await page.evaluate(() => (window as any).AIMEAT.auth.logout());
        const session = await page.evaluate(() => (window as any).AIMEAT.auth.login());
        expect(session).toBeNull();
    });

    test('getSession returns session after register', async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-gs-${TS}`, PASSWORD);

        const session = await page.evaluate(() => (window as any).AIMEAT.auth.getSession());
        expect(session).toBeTruthy();
        expect(session.owner).toBe(`pw-gs-${TS}`);
    });

    test('loginWithPassword works from clean browser', async ({ page }) => {
        // First register with password in a fresh page
        await loadHarness(page);
        const regUsername = `pw-pwlogin-${TS}`;
        await registerUser(page, regUsername, PASSWORD);

        // Clear localStorage to simulate a new device
        await page.evaluate(() => localStorage.clear());
        const noSession = await page.evaluate(() => (window as any).AIMEAT.auth.login());
        expect(noSession).toBeNull();

        // Login with password
        const session = await page.evaluate(
            ([u, p]) => (window as any).AIMEAT.auth.loginWithPassword(u, p),
            [regUsername, PASSWORD] as const,
        );
        expect(session).toBeTruthy();
        expect(session.owner).toBe(regUsername);
        expect(typeof session.jwt).toBe('string');
    });

    test('loginWithPassword rejects wrong password', async ({ page }) => {
        await loadHarness(page);
        const regUsername = `pw-wrongpw-${TS}`;
        await registerUser(page, regUsername, PASSWORD);
        await page.evaluate(() => localStorage.clear());

        const error = await page.evaluate(
            ([u]) => (window as any).AIMEAT.auth.loginWithPassword(u, 'WRONG').catch((e: any) => e.message),
            [regUsername] as const,
        );
        expect(error).toContain('Invalid username or password');
    });

    test('session.fetch makes authenticated API calls', async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-fetch-${TS}`, PASSWORD);

        const result = await page.evaluate(async () => {
            const session = (window as any).AIMEAT.auth.getSession();
            return session.fetch('/v1/wallet');
        });
        expect(result.ok).toBe(true);
        expect(typeof result.data.balance).toBe('number');
    });
});

// ═══════════════════════════════════════════════════════
// 3. Data Library (aimeat-data.js)
// ═══════════════════════════════════════════════════════

test.describe('aimeat-data', () => {
    test.beforeEach(async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-data-${TS}-${Math.random().toString(36).slice(2, 6)}`, PASSWORD);
    });

    test('set and get memory entry', async ({ page }) => {
        await page.evaluate(() => (window as any).AIMEAT.data.set('greeting', { msg: 'hello' }));
        const val = await page.evaluate(() => (window as any).AIMEAT.data.get('greeting'));
        expect(val).toEqual({ msg: 'hello' });
    });

    test('getEntry returns full metadata', async ({ page }) => {
        await page.evaluate(() => (window as any).AIMEAT.data.set('meta-test', 42));
        const entry = await page.evaluate(() => (window as any).AIMEAT.data.getEntry('meta-test'));
        expect(entry).toBeTruthy();
        expect(entry.key).toBe('meta-test');
        expect(entry.value).toBe(42);
        expect(typeof entry.version).toBe('number');
    });

    test('get throws for missing key', async ({ page }) => {
        const error = await page.evaluate(
            () => (window as any).AIMEAT.data.get('nonexistent-key-xyz').catch((e: any) => e.message),
        );
        expect(error).toContain('not found');
    });

    test('list returns stored keys', async ({ page }) => {
        await page.evaluate(() => (window as any).AIMEAT.data.set('k1', 'v1'));
        await page.evaluate(() => (window as any).AIMEAT.data.set('k2', 'v2'));
        const result = await page.evaluate(() => (window as any).AIMEAT.data.list());
        expect(result.items.length).toBeGreaterThanOrEqual(2);
    });

    test('search finds matching entries', async ({ page }) => {
        await page.evaluate(() => (window as any).AIMEAT.data.set('searchable-item', 'findme'));
        const result = await page.evaluate(() => (window as any).AIMEAT.data.search('searchable'));
        expect(result.results.length).toBeGreaterThanOrEqual(1);
    });

    test('update with optimistic locking', async ({ page }) => {
        await page.evaluate(() => (window as any).AIMEAT.data.set('locked', 'v1'));
        const entry = await page.evaluate(() => (window as any).AIMEAT.data.getEntry('locked'));

        const updated = await page.evaluate(
            ([ver]) => (window as any).AIMEAT.data.update('locked', 'v2', ver),
            [entry.version] as const,
        );
        expect(updated).toBeTruthy();
    });

    test('update with wrong version fails (409)', async ({ page }) => {
        await page.evaluate(() => (window as any).AIMEAT.data.set('conflict', 'original'));

        const error = await page.evaluate(
            () => (window as any).AIMEAT.data.update('conflict', 'stale', 0).catch((e: any) => e.message),
        );
        expect(error).toBeTruthy();
    });

    test('delete removes entry', async ({ page }) => {
        await page.evaluate(() => (window as any).AIMEAT.data.set('to-delete', 'bye'));
        await page.evaluate(() => (window as any).AIMEAT.data.delete('to-delete'));
        const error = await page.evaluate(
            () => (window as any).AIMEAT.data.get('to-delete').catch((e: any) => e.message),
        );
        expect(error).toContain('not found');
    });

    test('micro-memory add, list, mod, del', async ({ page }) => {
        const setName = `mm-${Date.now()}`;

        // add
        await page.evaluate(
            ([s]) => (window as any).AIMEAT.data.micro(s).add('score', '100'),
            [setName] as const,
        );

        // list
        const entries = await page.evaluate(
            ([s]) => (window as any).AIMEAT.data.micro(s).list(),
            [setName] as const,
        );
        expect(entries.entries.score).toBe('100');

        // mod
        await page.evaluate(
            ([s]) => (window as any).AIMEAT.data.micro(s).mod('score', '200'),
            [setName] as const,
        );

        const updated = await page.evaluate(
            ([s]) => (window as any).AIMEAT.data.micro(s).list(),
            [setName] as const,
        );
        expect(updated.entries.score).toBe('200');

        // del
        await page.evaluate(
            ([s]) => (window as any).AIMEAT.data.micro(s).del('score'),
            [setName] as const,
        );

        const afterDel = await page.evaluate(
            ([s]) => (window as any).AIMEAT.data.micro(s).list(),
            [setName] as const,
        );
        expect(afterDel.entries.score).toBeUndefined();
    });

    test('micro-memory batch write', async ({ page }) => {
        const setName = `batch-${Date.now()}`;

        const result = await page.evaluate(
            ([s]) => (window as any).AIMEAT.data.micro(s).batch({ a: '1', b: '2', c: '3' }),
            [setName] as const,
        );
        expect(result.count).toBe(3);
    });
});

// ═══════════════════════════════════════════════════════
// 4. Storage Library (aimeat-storage.js)
// ═══════════════════════════════════════════════════════

test.describe('aimeat-storage', () => {
    test.beforeEach(async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-stor-${TS}-${Math.random().toString(36).slice(2, 6)}`, PASSWORD);
    });

    test('upload and list files', async ({ page }) => {
        // Upload a base64 string
        const result = await page.evaluate(() =>
            (window as any).AIMEAT.storage.upload(btoa('Hello Playwright!'), {
                key: 'pw-test.txt',
                mime_type: 'text/plain',
            }),
        );
        expect(result.key).toBe('pw-test.txt');
        expect(result.size).toBeGreaterThan(0);

        // List
        const list = await page.evaluate(() => (window as any).AIMEAT.storage.list());
        expect(list.files.length).toBeGreaterThanOrEqual(1);
        expect(list.files.some((f: any) => f.key === 'pw-test.txt')).toBe(true);
    });

    test('download file content', async ({ page }) => {
        await page.evaluate(() =>
            (window as any).AIMEAT.storage.upload(btoa('Download me'), {
                key: 'pw-dl.txt',
                mime_type: 'text/plain',
            }),
        );

        const text = await page.evaluate(async () => {
            const blob = await (window as any).AIMEAT.storage.download('pw-dl.txt');
            return blob.text();
        });
        expect(text).toBe('Download me');
    });

    test('delete file', async ({ page }) => {
        await page.evaluate(() =>
            (window as any).AIMEAT.storage.upload(btoa('delete me'), {
                key: 'pw-del.txt',
                mime_type: 'text/plain',
            }),
        );

        await page.evaluate(() => (window as any).AIMEAT.storage.delete('pw-del.txt'));

        const list = await page.evaluate(() => (window as any).AIMEAT.storage.list());
        expect(list.files.some((f: any) => f.key === 'pw-del.txt')).toBe(false);
    });

    test('metadata returns file info', async ({ page }) => {
        await page.evaluate(() =>
            (window as any).AIMEAT.storage.upload(btoa('meta data'), {
                key: 'pw-meta.txt',
                mime_type: 'text/plain',
            }),
        );

        const meta = await page.evaluate(() => (window as any).AIMEAT.storage.metadata('pw-meta.txt'));
        expect(meta.contentType).toContain('text/plain');
        expect(meta.contentLength).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════
// 5. Social Library (aimeat-social.js)
// ═══════════════════════════════════════════════════════

test.describe('aimeat-social', () => {
    test.beforeEach(async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-soc-${TS}-${Math.random().toString(36).slice(2, 6)}`, PASSWORD);
    });

    test('create board, post, list posts, react, reply', async ({ page }) => {
        // Create private board
        const board = await page.evaluate(
            () => (window as any).AIMEAT.social.createBoard(`pw-board-${Date.now()}`, { visibility: 'private' }),
        );
        expect(board.id).toBeTruthy();

        // Post to it
        const post = await page.evaluate(
            ([bid]) => (window as any).AIMEAT.social.post(bid, { title: 'PW Test', body: 'Hello from Playwright!' }),
            [board.id] as const,
        );
        expect(post.id).toBeTruthy();

        // List posts (private board needs auth — use session.fetch directly)
        const postsList = await page.evaluate(
            ([bid]) => {
                const session = (window as any).AIMEAT.auth.getSession();
                return session.fetch('/v1/boards/' + encodeURIComponent(bid) + '/posts');
            },
            [board.id] as const,
        );
        expect(postsList.data.posts.length).toBeGreaterThanOrEqual(1);

        // Get single post (private board — use session.fetch)
        const single = await page.evaluate(
            ([bid, pid]) => {
                const session = (window as any).AIMEAT.auth.getSession();
                return session.fetch('/v1/boards/' + encodeURIComponent(bid) + '/posts/' + encodeURIComponent(pid));
            },
            [board.id, post.id] as const,
        );
        expect(single.data.title).toBe('PW Test');

        // React
        const reaction = await page.evaluate(
            ([bid, pid]) => (window as any).AIMEAT.social.react(bid, pid, '❤️'),
            [board.id, post.id] as const,
        );
        expect(reaction).toBeTruthy();

        // Reply
        const reply = await page.evaluate(
            ([bid, pid]) => (window as any).AIMEAT.social.reply(bid, pid, 'Nice post!'),
            [board.id, post.id] as const,
        );
        expect(reply.id).toBeTruthy();
    });

    test('subscribe and unsubscribe', async ({ page }) => {
        const board = await page.evaluate(
            () => (window as any).AIMEAT.social.createBoard(`pw-sub-${Date.now()}`, { visibility: 'private' }),
        );

        await page.evaluate(
            ([bid]) => (window as any).AIMEAT.social.subscribe(bid, {}),
            [board.id] as const,
        );

        const subs = await page.evaluate(() => (window as any).AIMEAT.social.subscriptions());
        expect(subs.subscriptions.length).toBeGreaterThanOrEqual(1);

        await page.evaluate(
            ([bid]) => (window as any).AIMEAT.social.unsubscribe(bid),
            [board.id] as const,
        );
    });
});

// ═══════════════════════════════════════════════════════
// 6. Wallet Library (aimeat-wallet.js)
// ═══════════════════════════════════════════════════════

test.describe('aimeat-wallet', () => {
    test.beforeEach(async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-wal-${TS}-${Math.random().toString(36).slice(2, 6)}`, PASSWORD);
    });

    test('balance returns numbers', async ({ page }) => {
        const bal = await page.evaluate(() => (window as any).AIMEAT.wallet.balance());
        expect(typeof bal.balance).toBe('number');
        expect(typeof bal.available).toBe('number');
    });

    test('transactions returns array', async ({ page }) => {
        const txs = await page.evaluate(() => (window as any).AIMEAT.wallet.transactions());
        expect(Array.isArray(txs.transactions)).toBe(true);
    });

    test('request morsels', async ({ page }) => {
        const result = await page.evaluate(
            () => (window as any).AIMEAT.wallet.request(5, 'Playwright test'),
        );
        expect(typeof result.new_balance).toBe('number');
    });
});

// ═══════════════════════════════════════════════════════
// 7. Work Library (aimeat-work.js)
// ═══════════════════════════════════════════════════════

test.describe('aimeat-work', () => {
    test('catalogue, agents, stats, hash (public endpoints)', async ({ page }) => {
        await loadHarness(page);

        const cat = await page.evaluate(() => (window as any).AIMEAT.work.catalogue());
        expect(Array.isArray(cat.actions)).toBe(true);

        const agents = await page.evaluate(() => (window as any).AIMEAT.work.agents());
        expect(Array.isArray(agents.agents)).toBe(true);

        const stats = await page.evaluate(() => (window as any).AIMEAT.work.stats());
        expect(typeof stats.node_id).toBe('string');

        const hash = await page.evaluate(() => (window as any).AIMEAT.work.hash());
        expect(typeof hash.hash).toBe('string');
    });

    test('full work lifecycle: publish → request → accept → deliver → rate', async ({ page }) => {
        await loadHarness(page);
        await registerUser(page, `pw-work-${TS}-${Math.random().toString(36).slice(2, 6)}`, PASSWORD);

        // Publish an action via session.fetch (work lib doesn't expose publish — that's POST /v1/actions)
        const actionId = `pw-action-${Date.now()}`;
        const publishResult = await page.evaluate(
            ([aid]) => {
                const session = (window as any).AIMEAT.auth.getSession();
                return session.fetch('/v1/actions', {
                    method: 'POST',
                    body: JSON.stringify({
                        id: aid,
                        display_name: 'PW Test Action',
                        description: 'Created by Playwright test',
                        category: 'utility',
                        input_schema: { type: 'object' },
                        output_schema: { type: 'object' },
                        pricing: { base_morsels: 1 },
                    }),
                });
            },
            [actionId] as const,
        );
        expect(publishResult.ok).toBe(true);

        // Get action detail
        const detail = await page.evaluate(
            ([aid]) => (window as any).AIMEAT.work.getAction(aid),
            [actionId] as const,
        );
        expect(detail.display_name).toBe('PW Test Action');

        // Get own gaii for self-request
        const gaii = await page.evaluate(() => (window as any).AIMEAT.auth.getSession().gaii);

        // Submit work request (self-assign for test simplicity)
        const workReq = await page.evaluate(
            ([aid, g]) => (window as any).AIMEAT.work.request(aid, g, { prompt: 'test' }),
            [actionId, gaii] as const,
        );
        expect(workReq.tracking_code).toBeTruthy();

        const tc = workReq.tracking_code;

        // Check inbox
        const inbox = await page.evaluate(() => (window as any).AIMEAT.work.inbox());
        expect(inbox.items.length).toBeGreaterThanOrEqual(1);

        // Check status
        const status = await page.evaluate(
            ([t]) => (window as any).AIMEAT.work.status(t),
            [tc] as const,
        );
        expect(status.tracking_code).toBe(tc);

        // Accept
        const accepted = await page.evaluate(
            ([t]) => (window as any).AIMEAT.work.accept(t),
            [tc] as const,
        );
        expect(accepted).toBeTruthy();

        // Deliver
        const delivered = await page.evaluate(
            ([t]) => (window as any).AIMEAT.work.deliver(t, { result: 'done' }),
            [tc] as const,
        );
        expect(delivered).toBeTruthy();

        // Rate
        const rated = await page.evaluate(
            ([t]) => (window as any).AIMEAT.work.rate(t, 'positive', 'Great!'),
            [tc] as const,
        );
        expect(rated).toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════
// 8. Login Modal UI
// ═══════════════════════════════════════════════════════

test.describe('Login Modal UI', () => {
    test('mountLoginButton shows button and opens modal', async ({ page }) => {
        await loadHarness(page);

        // Add a container div
        await page.evaluate(() => {
            const div = document.createElement('div');
            div.id = 'auth-container';
            document.body.appendChild(div);
        });

        // Mount login button
        await page.evaluate(() => (window as any).AIMEAT.auth.mountLoginButton('#auth-container'));

        // Button should appear
        const btn = page.locator('#auth-container button');
        await expect(btn).toBeVisible();

        // Click to open modal
        await btn.click();

        // Modal should appear with username, password, and sign in button
        await expect(page.locator('#aimeat-username')).toBeVisible();
        await expect(page.locator('#aimeat-password')).toBeVisible();
        await expect(page.locator('#aimeat-go-btn')).toBeVisible();
        await expect(page.locator('#aimeat-cancel-btn')).toBeVisible();
    });

    test('modal cancel closes it', async ({ page }) => {
        await loadHarness(page);

        await page.evaluate(() => {
            const div = document.createElement('div');
            div.id = 'auth-container';
            document.body.appendChild(div);
            (window as any).AIMEAT.auth.mountLoginButton('#auth-container');
        });

        await page.locator('#auth-container button').click();
        await expect(page.locator('#aimeat-cancel-btn')).toBeVisible();

        await page.locator('#aimeat-cancel-btn').click();
        // After cancel, modal should be removed from the DOM
        await expect(page.locator('#aimeat-modal')).toHaveCount(0);
    });

    test('modal registers user with username + password', async ({ page }) => {
        await loadHarness(page);

        await page.evaluate(() => {
            const div = document.createElement('div');
            div.id = 'auth-container';
            document.body.appendChild(div);
            (window as any).AIMEAT.auth.mountLoginButton('#auth-container');
        });

        await page.locator('#auth-container button').click();
        await page.fill('#aimeat-username', `pw-modal-${Date.now()}`);
        await page.fill('#aimeat-password', PASSWORD);
        await page.fill('#aimeat-displayname', 'Modal Test User');
        await page.click('#aimeat-go-btn');

        // Modal should close after successful registration
        await expect(page.locator('#aimeat-modal')).toHaveCount(0, { timeout: 15_000 });

        // Session should be active (getSession returns the object)
        const hasSession = await page.evaluate(() => {
            const s = (window as any).AIMEAT.auth.getSession();
            return s ? { jwt: !!s.jwt, owner: s.owner } : null;
        });
        expect(hasSession).toBeTruthy();
        expect(hasSession.jwt).toBe(true);
    });

    test('modal shows error for short password', async ({ page }) => {
        await loadHarness(page);

        await page.evaluate(() => {
            const div = document.createElement('div');
            div.id = 'auth-container';
            document.body.appendChild(div);
            (window as any).AIMEAT.auth.mountLoginButton('#auth-container');
        });

        await page.locator('#auth-container button').click();
        await page.fill('#aimeat-username', 'someuser');
        await page.fill('#aimeat-password', 'ab'); // Too short
        await page.click('#aimeat-go-btn');

        // Error should appear
        await expect(page.locator('#aimeat-error')).toBeVisible();
        const errorText = await page.locator('#aimeat-error').textContent();
        expect(errorText).toContain('4 characters');
    });
});
