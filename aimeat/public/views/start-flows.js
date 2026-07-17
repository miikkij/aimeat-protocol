/**
 * @file start-flows.js
 * @description Data + logic for the /v1/start diagnosis page: entrance configs
 *   (per LinkedIn-post angle, selected via ?from=), diagnostic questions with
 *   scores, verdict tiers, the build questions (path / tool / need / automation)
 *   and the playbook builder that turns the answers into a checklist with real,
 *   verified attach commands (sourced from connect.html — do not invent new ones).
 *   All user-visible copy is i18n key + English fallback pairs `{ k, f }`,
 *   resolved by the view; Finnish lives in locales/fi.json.
 * @structure ENTRANCES, BUILD_QUESTIONS, scoreAnswers(), tierFor(),
 *   buildPlaybook(), playbookToMarkdown()
 * @usage import { ENTRANCES, ... } from './start-flows.js' (relative — no importmap entry)
 * @version-history
 *   v1.1.0 — 2026-07-17 — Every playbook ends with an Experience Center section
 *     (the hands-on academy at experience-center.apps.aimeat.io) so the path
 *     continues past the first task.
 *   v1.0.0 — 2026-06-11 — Initial: jira + default entrances, 4 verdict tiers,
 *     hosted/self/help playbooks (Spider rules: diagnosis framing, shareable
 *     verdict, ends in a copyable prompt, no email gate).
 */

// ── Diagnostic questions (shared by jira + default entrances) ──

const Q_IDEA_FATE = {
  id: 'ideaFate',
  title: { k: 'start.q1.title', f: 'When someone drops a good idea, what happens to it?' },
  options: [
    { id: 'prod', score: 3, text: { k: 'start.q1.prod', f: "It's in production before the evening news" } },
    { id: 'backlog', score: 1, text: { k: 'start.q1.backlog', f: 'Into the backlog. Groomed. Maybe Q3.' } },
    { id: 'grave', score: 0, text: { k: 'start.q1.grave', f: "It's taken to JIRA to die. Ceremonies twice a week." } },
    { id: 'chaos', score: 0, text: { k: 'start.q1.chaos', f: 'Nowhere. Someone might remember it next week.' } },
  ],
};

const Q_AI_MEMORY = {
  id: 'aiMemory',
  title: { k: 'start.q2.title', f: 'What does your AI remember about yesterday?' },
  options: [
    { id: 'all', score: 3, text: { k: 'start.q2.all', f: 'Everything: it has a memory, a task queue and a work history' } },
    { id: 'paste', score: 1, text: { k: 'start.q2.paste', f: 'Whatever I bother to copy-paste into the chat' } },
    { id: 'none', score: 0, text: { k: 'start.q2.none', f: 'Nothing. I reintroduce myself to it every morning.' } },
  ],
};

const Q_AGENT_HOME = {
  id: 'agentHome',
  title: { k: 'start.q3.title', f: "Where does your AI's work live?" },
  options: [
    { id: 'home', score: 3, text: { k: 'start.q3.home', f: 'In a shared home where the team and other agents can find it' } },
    { id: 'disk', score: 1, text: { k: 'start.q3.disk', f: 'On my machine, in a folder called final_v3_REAL' } },
    { id: 'scattered', score: 0, text: { k: 'start.q3.scattered', f: 'Scattered across chat histories. Nobody digs those up.' } },
  ],
};

// ── Entrances — one per LinkedIn-post angle (?from=jira|sotku|omistus).
// sotku/omistus copy is not written yet; they fall back to the neutral
// entrance so the links can ship before their entrance copy does. ──

export const ENTRANCES = {
  jira: {
    id: 'jira',
    title: { k: 'start.jira.title', f: 'How dead is your JIRA?' },
    sub: { k: 'start.jira.sub', f: 'The diagnosis takes 90 seconds. No email gate, no form, no sales call. At the end you get a verdict and a playbook for trying the cure yourself.' },
    questions: [Q_IDEA_FATE, Q_AI_MEMORY, Q_AGENT_HOME],
  },
  default: {
    id: 'default',
    title: { k: 'start.def.title', f: 'What shape are your agents in?' },
    sub: { k: 'start.def.sub', f: 'The diagnosis takes 90 seconds. No email gate, no form, no sales call. At the end you get a verdict and a playbook for trying the cure yourself.' },
    questions: [Q_IDEA_FATE, Q_AI_MEMORY, Q_AGENT_HOME],
  },
};

export function entranceFor(slug) {
  return ENTRANCES[slug] || ENTRANCES.default;
}

// ── Verdict tiers (max score 9) ──

export const TIERS = [
  { id: 't0', min: 0, name: { k: 'start.t0.name', f: 'Level 0: The Graveyard' },
    desc: { k: 'start.t0.desc', f: 'Your ideas die ceremonially and your AI has amnesia. You pay for tools that remember nothing and a process that ships nothing. Good news: the only way is up, and the climb starts below.' } },
  { id: 't1', min: 3, name: { k: 'start.t1.name', f: 'Level 1: In Therapy' },
    desc: { k: 'start.t1.desc', f: 'Your AI goes to therapy, not to work: you carry its context in every morning and it forgets everything by night. You hired a brilliant employee and gave it amnesia.' } },
  { id: 't2', min: 6, name: { k: 'start.t2.name', f: 'Level 2: Working Without a Manager' },
    desc: { k: 'start.t2.desc', f: 'You have agents and they do things, but nothing sticks and nobody runs the whole. Missing: a home, a memory and a manager.' } },
  { id: 't3', min: 8, name: { k: 'start.t3.name', f: 'Level 3: Goes to Work' },
    desc: { k: 'start.t3.desc', f: 'Your agents actually go to work. Rare. Congratulations. Your playbook shows how to scale this and own the whole chain yourself.' } },
];

export function scoreAnswers(questions, answers) {
  let sum = 0;
  for (const q of questions) {
    const opt = q.options.find((o) => o.id === answers[q.id]);
    if (opt) sum += opt.score;
  }
  return sum;
}

export function tierFor(score) {
  let tier = TIERS[0];
  for (const t of TIERS) if (score >= t.min) tier = t;
  return tier;
}

// ── Build questions (asked after the verdict; they become the playbook) ──

export const Q_PATH = {
  id: 'path',
  title: { k: 'start.q4.title', f: 'How do you want to try this?' },
  options: [
    { id: 'hosted', text: { k: 'start.q4.hosted', f: 'Try it first: hosted aimeat.io, nothing to install' } },
    { id: 'self', text: { k: 'start.q4.self', f: "I'll build it myself: my own node on my own hardware (MIT, free)" } },
    { id: 'help', text: { k: 'start.q4.help', f: 'I want help: you do it ($$)' } },
  ],
};

export const Q_TOOL = {
  id: 'tool',
  title: { k: 'start.q5.title', f: 'What tool does your AI live in?' },
  options: [
    { id: 'claude', text: { k: 'start.q5.claude', f: 'Claude (web or desktop)' } },
    { id: 'claudeCode', text: { k: 'start.q5.claudeCode', f: 'Claude Code (terminal)' } },
    { id: 'copilot', text: { k: 'start.q5.copilot', f: 'VS Code + Copilot' } },
    { id: 'cursor', text: { k: 'start.q5.cursor', f: 'Cursor' } },
    { id: 'otherChat', text: { k: 'start.q5.otherChat', f: 'Some other chat (ChatGPT, Gemini, …)' } },
  ],
};

export const Q_NEED = {
  id: 'need',
  title: { k: 'start.q5n.title', f: 'What would you want agents to handle first?' },
  options: [
    { id: 'code', text: { k: 'start.q5n.code', f: 'Code and PRs' } },
    { id: 'docs', text: { k: 'start.q5n.docs', f: 'Documentation and a home for knowledge' } },
    { id: 'watch', text: { k: 'start.q5n.watch', f: "Monitoring and reporting: what's happening, every morning" } },
    { id: 'unsure', text: { k: 'start.q5n.unsure', f: "I don't know yet, that's why I'm asking" } },
  ],
};

export const Q_AUTOMATION = {
  id: 'automation',
  title: { k: 'start.q6.title', f: 'Does the work happen by itself, or when you say so?' },
  options: [
    { id: 'manual', text: { k: 'start.q6.manual', f: 'When I say so: the AI helps when I ask' } },
    { id: 'routine', text: { k: 'start.q6.routine', f: 'An agreed routine: the AI checks the queue regularly' } },
    { id: 'continuous', text: { k: 'start.q6.continuous', f: 'By itself: the AI works while I sleep' } },
  ],
};

/** The build-phase question sequence for a chosen path. The help path skips
 *  the automation question — its playbook never uses the answer, and we don't
 *  ask what we don't use. */
export function buildQuestionsFor(answers) {
  if (answers.path === 'help') return [Q_PATH, Q_NEED];
  return [Q_PATH, Q_TOOL, Q_AUTOMATION];
}

// ── Playbook builder ──
// Returns sections: { title: {k,f}, items: [{ text?: {k,f}, code?: string,
// prompt?: {k,f}, link?: { href, label: {k,f} } }] }.
// Commands come from connect.html — keep them verbatim, do not invent.

/** The closing section of every playbook: the path continues in the Experience Center. */
function ecSection() {
  return {
    title: { k: 'start.pb.ec.title', f: 'Keep going: the Experience Center' },
    items: [
      { text: { k: 'start.pb.ec.a', f: 'A hands-on academy for the whole ecosystem: connect your AI (the nicest way), then agents, apps, organisms and automation — layer by layer, with try-it links.' },
        link: { href: 'https://experience-center.apps.aimeat.io', label: { k: 'start.pb.ec.link', f: 'Open the Experience Center →' } } },
    ],
  };
}

export function buildPlaybook(answers, mcpUrl) {
  const { path, tool, need, automation } = answers;
  const sections = [];

  if (path === 'help') {
    const needText = { k: `start.q5n.${need}`, f: '' };
    sections.push({
      title: { k: 'start.pb.h1.title', f: 'Step 1: Tell us what you need' },
      items: [
        { text: { k: 'start.pb.h1.a', f: "Send a message to jouni.miikki@aimeat.io. Subject 'Agents', body: your pick below. You'll get an honest assessment: what to build yourself, what to buy." } },
        { text: needText, quote: true },
      ],
    });
    sections.push({
      title: { k: 'start.pb.h2.title', f: 'Step 2: See the pricing' },
      items: [
        { text: { k: 'start.pb.h2.a', f: 'Self-serve tiers and done-for-you packages:' },
          link: { href: '/v1/pricing', label: { k: 'start.pb.h2.link', f: 'See pricing →' } } },
      ],
    });
    sections.push({
      title: { k: 'start.pb.h3.title', f: 'Step 3: Try it meanwhile' },
      items: [
        { text: { k: 'start.pb.h3.a', f: "Nothing stops you from seeing it yourself before paying anything: create a free account and connect your own AI." },
          link: { href: '/v1/portal', label: { k: 'start.pb.h3.link', f: 'Create a free account →' } } },
      ],
    });
    sections.push(ecSection());
    return sections;
  }

  // Step 1 — account / own node
  if (path === 'self') {
    sections.push({
      title: { k: 'start.pb.s1self.title', f: 'Step 1: Install your own node' },
      items: [
        { text: { k: 'start.pb.s1self.a', f: 'Clone and run the init wizard, it asks the rest:' },
          code: 'git clone https://github.com/miikkij/aimeat-protocol\ncd aimeat-protocol\npnpm install && pnpm aimeat init' },
        { text: { k: 'start.pb.s1self.b', f: 'Everything below is then done against your own node: replace the aimeat.io address with yours. Your hardware, your keys, your data.' } },
      ],
    });
  } else {
    sections.push({
      title: { k: 'start.pb.s1.title', f: 'Step 1: An account and a home' },
      items: [
        { text: { k: 'start.pb.s1.a', f: "Create a free account. No card, no payment. The account is your agent's home and your permission for it to exist." },
          link: { href: '/v1/portal', label: { k: 'start.pb.s1.link', f: 'Create account →' } } },
      ],
    });
  }

  // Step 2 — connect the AI (per tool, commands verbatim from connect.html)
  const connect = { title: { k: 'start.pb.s2.title', f: 'Step 2: Connect your AI' }, items: [] };
  if (tool === 'claude') {
    connect.items.push({ text: { k: 'start.pb.s2.claude', f: 'Open Claude: Settings → Connectors → Add custom connector, and paste this address:' }, code: mcpUrl });
    connect.items.push({ text: { k: 'start.pb.s2.claudeNote', f: 'The free claude.ai tier fits one custom connector, and that is enough for this.' } });
  } else if (tool === 'claudeCode') {
    connect.items.push({ text: { k: 'start.pb.s2.cli', f: 'Run this in a terminal:' }, code: `claude mcp add aimeat --transport http ${mcpUrl}` });
  } else if (tool === 'copilot') {
    connect.items.push({ text: { k: 'start.pb.s2.cli', f: 'Run this in a terminal:' }, code: `code --add-mcp '{"name":"aimeat","url":"${mcpUrl}"}'` });
  } else if (tool === 'cursor') {
    connect.items.push({ text: { k: 'start.pb.s2.cursor', f: 'Use the 1-click install on the connect page:' },
      link: { href: '/v1/connect', label: { k: 'start.pb.s2.cursorLink', f: 'Open the connect page →' } } });
  } else {
    connect.items.push({ text: { k: 'start.pb.s2.other', f: 'If your tool supports Connectors / custom MCP, paste this address into it:' }, code: mcpUrl });
    connect.items.push({ text: { k: 'start.pb.s2.otherNote', f: "No MCP support? AIMEAT also works prompt-driven: the app composes the prompts, you carry them to your chat and bring the answers back. Free, and works with any AI." } });
  }
  // Self-hosted on localhost? A cloud AI can't reach a localhost MCP address — point to the connector.
  if (/localhost|127\.0\.0\.1/.test(mcpUrl || '')) {
    connect.items.push({ text: { k: 'start.pb.s2.localhost', f: "Running AIMEAT on your own machine (localhost)? A cloud AI like claude.ai can't reach a localhost address over MCP. Install the connector and run `aimeat connect serve` — it bridges your local node to the AI." }, code: 'aimeat connect serve' });
  }
  connect.items.push({ text: { k: 'start.pb.s2.approve', f: 'When the AI asks for access, approve the agent in your profile and pick its permissions. No agent is ever created without your approval.' } });
  sections.push(connect);

  // Step 3 — startup prompt (the conversion: the AI creates the first organism)
  sections.push({
    title: { k: 'start.pb.s3.title', f: 'Step 3: Put your AI to work' },
    items: [
      { text: { k: 'start.pb.s3.lead', f: 'Copy this prompt to your AI:' },
        prompt: { k: 'start.pb.s3.prompt', f: "You are connected to the AIMEAT platform via MCP. Create an organism for me called 'My Office' with a workspace. Then read what's there, ask me what I want you to do, and record my answer as the first task in the workspace. Confirm when the task is saved." } },
      { text: { k: 'start.pb.s3.check', f: 'Check your profile: the task appeared. You just watched the whole loop: idea → memory → task queue. No ceremonies.' } },
    ],
  });

  // Step 4 — first real job
  sections.push({
    title: { k: 'start.pb.s4.title', f: 'Step 4: The first real job' },
    items: [
      { text: { k: 'start.pb.s4.a', f: 'Give the AI one small, real task from your day: file a note, turn a project status into a document, sort a list.' } },
      { text: { k: 'start.pb.s4.b', f: 'Everything the AI writes stays with you. The memory, the documents and the tasks are yours, not an AI vendor’s.' } },
    ],
  });

  // Step 5 — automation level
  const auto = { title: { k: 'start.pb.s5.title', f: 'Step 5: Automation level' }, items: [] };
  if (automation === 'continuous') {
    auto.items.push({ text: { k: 'start.pb.s5.continuous', f: 'You picked: by itself. A connector serve daemon runs your agent in the background and tasks arrive as pushes, no polling. A fleet of 33 agents runs in production on this model.' },
      link: { href: '/v1/connect', label: { k: 'start.pb.s5.link', f: 'Connector docs →' } } });
  } else if (automation === 'routine') {
    auto.items.push({ text: { k: 'start.pb.s5.routine', f: 'You picked: an agreed routine. Agree a scheduled check with your AI that reads the task queue regularly. AIMEAT’s own schedules work as the wake-up call and reminder.' } });
  } else {
    auto.items.push({ text: { k: 'start.pb.s5.manual', f: "You picked: when I say so. Start every session with the prompt: 'Read the open tasks in the workspace and handle them.' You are the scheduler, and that is enough to start." } });
  }
  if (automation !== 'continuous') {
    auto.items.push({ text: { k: 'start.pb.s5.upgrade', f: 'You can raise the level any time: by hand → routine → daemon. The playbook does not expire.' } });
  }
  sections.push(auto);

  sections.push(ecSection());
  return sections;
}

/** Plain-markdown rendering of the playbook for the copy button. */
export function playbookToMarkdown(sections, trr, titleText) {
  const lines = [`# ${titleText}`, ''];
  for (const s of sections) {
    lines.push(`## ${trr(s.title)}`, '');
    for (const it of s.items) {
      if (it.text) lines.push(it.quote ? `> ${trr(it.text)}` : `- [ ] ${trr(it.text)}`);
      if (it.code) lines.push('', '```', it.code, '```', '');
      if (it.prompt) lines.push('', '> ' + trr(it.prompt), '');
      if (it.link) lines.push(`  ${trr(it.link.label)} ${it.link.href}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
