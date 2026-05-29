# Examples

## `basic_crew.py`

A 3-agent crew (Researcher + Writer + AIMEAT Liaison) that:
1. Has the liaison handle Hello Integration automatically
2. Researcher gathers three facts
3. Writer turns them into a 2-paragraph summary
4. Liaison writes the summary to AIMEAT memory and reports telemetry

**Prereqs:**
- AIMEAT node running (default: `http://localhost:40050`)
- Agent registered: `npx aimeat connect add --agent demo-crew --owner <you>`
- LLM configured (`OPENAI_API_KEY` or equivalent)

**Run:**
```bash
pip install aimeat-crewai
export OPENAI_API_KEY=sk-...
python basic_crew.py
```

To target a different agent identity, set `AIMEAT_AGENT_NAME`:
```bash
AIMEAT_AGENT_NAME=marketing-crew python basic_crew.py
```
