import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMcpBridge, structured } from "../src/ui/bridge.js";
import {
  dashboardCounts,
  eventLabel,
  formatTime,
  latestHandoff,
  nodeCreationPayload,
  taskCreationPayload,
  topologyLanes
} from "../src/ui/model.js";
import "../src/ui/styles.css";

const bridge = createMcpBridge(window);
const emptyConstraints = { shared: "", codex: "", claude: "", alignment: "", questions: "", notes: "" };

function Modal({ title, children, onClose, wide = false }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="关闭">×</button></header>
      {children}
    </section>
  </div>;
}

function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function ConstraintFields({ value, onChange }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  return <div className="constraint-grid">
    <Field label="共享约束" hint="每行一条，应用于所有成员"><textarea value={value.shared} onChange={(event) => set("shared", event.target.value)} /></Field>
    <Field label="Codex 约束"><textarea value={value.codex} onChange={(event) => set("codex", event.target.value)} /></Field>
    <Field label="Claude 约束"><textarea value={value.claude} onChange={(event) => set("claude", event.target.value)} /></Field>
    <Field label="契约对齐约束"><textarea value={value.alignment} onChange={(event) => set("alignment", event.target.value)} /></Field>
  </div>;
}

function TaskWizard({ onClose, onCreate }) {
  const [draft, setDraft] = useState({ title: "", goal: "", requireBothAgents: true, checkIntervalSeconds: 120, strategy: "", constraints: emptyConstraints });
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (skip) => {
    if (!draft.goal.trim()) return;
    await onCreate(taskCreationPayload(draft, skip));
  };
  return <Modal title="建立混合原生团队" wide onClose={onClose}>
    <div className="form-grid two">
      <Field label="任务标题"><input value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：实现完整的订单管理应用" /></Field>
      <Field label="检查周期（秒）"><input type="number" min="15" max="3600" value={draft.checkIntervalSeconds} onChange={(event) => update("checkIntervalSeconds", event.target.value)} /></Field>
    </div>
    <Field label="总目标"><textarea className="goal" value={draft.goal} onChange={(event) => update("goal", event.target.value)} placeholder="描述最终可验收结果，而不是单个 Agent 的工作" /></Field>
    <Field label="分工策略"><input value={draft.strategy} onChange={(event) => update("strategy", event.target.value)} placeholder="留空时由 Codex 根据能力、风险与文件边界动态决定" /></Field>
    <label className="checkbox"><input type="checkbox" checked={draft.requireBothAgents} onChange={(event) => update("requireBothAgents", event.target.checked)} />要求 Codex 与 Claude 都承担明确职责</label>
    <div className="section-title">开发前约束（可明确跳过）</div>
    <ConstraintFields value={draft.constraints} onChange={(constraints) => update("constraints", constraints)} />
    <footer className="modal-actions"><button onClick={() => submit(true)}>跳过约束并创建</button><button className="primary" onClick={() => submit(false)}>写入约束并创建</button></footer>
  </Modal>;
}

function ConstraintEditor({ task, onClose, onSave }) {
  const [value, setValue] = useState(emptyConstraints);
  return <Modal title={`设置约束 · ${task.title}`} wide onClose={onClose}>
    <p className="muted">约束一旦有节点开工便不可重写；后续变化应通过契约变更或移交流程记录。</p>
    <ConstraintFields value={value} onChange={setValue} />
    <footer className="modal-actions"><button onClick={() => onSave(task.id, value, true)}>明确跳过</button><button className="primary" onClick={() => onSave(task.id, value, false)}>保存约束</button></footer>
  </Modal>;
}

function NodeWizard({ task, onClose, onCreate }) {
  const [draft, setDraft] = useState({ taskId: task.id, title: "", goal: "", agent: "codex", executionMode: "codex-lead", role: "implementation", files: "", dependencies: "", constraints: "", rationale: "", capabilities: "" });
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const setAgent = (agent) => setDraft((current) => ({ ...current, agent, executionMode: agent === "claude" ? "claude-cli" : "codex-lead" }));
  return <Modal title={`添加团队节点 · ${task.title}`} wide onClose={onClose}>
    <div className="form-grid two">
      <Field label="节点标题"><input value={draft.title} onChange={(event) => update("title", event.target.value)} /></Field>
      <Field label="职责"><input value={draft.role} onChange={(event) => update("role", event.target.value)} placeholder="frontend / backend / alignment / test" /></Field>
      <Field label="Agent"><select value={draft.agent} onChange={(event) => setAgent(event.target.value)}><option value="codex">Codex</option><option value="claude">Claude</option></select></Field>
      <Field label="执行模式"><select value={draft.executionMode} onChange={(event) => update("executionMode", event.target.value)}>
        {draft.agent === "codex" ? <><option value="codex-lead">Codex 主线程开发</option><option value="codex-subagent">Codex 原生 subagent</option><option value="alignment">契约对齐 Agent</option></> : <><option value="claude-cli">Claude CLI worktree</option><option value="alignment">Claude 契约对齐</option></>}
      </select></Field>
    </div>
    <Field label="节点目标"><textarea className="goal" value={draft.goal} onChange={(event) => update("goal", event.target.value)} /></Field>
    <div className="form-grid two">
      <Field label="文件范围" hint="逗号或换行分隔"><textarea value={draft.files} onChange={(event) => update("files", event.target.value)} /></Field>
      <Field label="依赖节点 ID" hint="逗号或换行分隔"><textarea value={draft.dependencies} onChange={(event) => update("dependencies", event.target.value)} /></Field>
      <Field label="选择理由"><textarea value={draft.rationale} onChange={(event) => update("rationale", event.target.value)} /></Field>
      <Field label="能力依据" hint="每行一条"><textarea value={draft.capabilities} onChange={(event) => update("capabilities", event.target.value)} /></Field>
    </div>
    <Field label="节点附加约束" hint="每行一条"><textarea value={draft.constraints} onChange={(event) => update("constraints", event.target.value)} /></Field>
    <footer className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => draft.title.trim() && draft.goal.trim() && onCreate(nodeCreationPayload(draft))}>添加节点</button></footer>
  </Modal>;
}

function CheckpointEditor({ task, node, onClose, onSave }) {
  const [value, setValue] = useState({ phase: node.progress?.phase || "implementation", summary: "", percent: node.progress?.percent ?? 50, filesTouched: (node.progress?.filesTouched || []).join("\n"), blockers: "", nextCheckSeconds: task.team?.checkIntervalSeconds || 120 });
  const update = (key, next) => setValue((current) => ({ ...current, [key]: next }));
  return <Modal title={`记录检查点 · ${node.title}`} onClose={onClose}>
    <div className="form-grid two"><Field label="阶段"><input value={value.phase} onChange={(event) => update("phase", event.target.value)} /></Field><Field label="完成度"><input type="number" min="0" max="100" value={value.percent} onChange={(event) => update("percent", event.target.value)} /></Field></div>
    <Field label="进度摘要"><textarea className="goal" value={value.summary} onChange={(event) => update("summary", event.target.value)} /></Field>
    <Field label="已触碰文件" hint="范围外文件会自动触发移交"><textarea value={value.filesTouched} onChange={(event) => update("filesTouched", event.target.value)} /></Field>
    <Field label="阻塞项"><textarea value={value.blockers} onChange={(event) => update("blockers", event.target.value)} /></Field>
    <footer className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => onSave({ taskId: task.id, nodeId: node.id, ...value, percent: Number(value.percent), nextCheckSeconds: Number(value.nextCheckSeconds), filesTouched: value.filesTouched.split(/\r?\n/).filter(Boolean), blockers: value.blockers.split(/\r?\n/).filter(Boolean) })}>记录</button></footer>
  </Modal>;
}

function HandoffEditor({ task, node, onClose, onSave }) {
  const [value, setValue] = useState({ reason: "capability_gap", evidence: "", recommendedAgent: node.agent === "claude" ? "codex" : "claude" });
  const update = (key, next) => setValue((current) => ({ ...current, [key]: next }));
  const reasons = ["boundary_violation", "capability_gap", "validation_failure", "dependency_change", "contract_change", "security_escalation", "runtime_failure", "timeout", "scope_conflict", "priority_change", "workload_balance", "user_request", "other"];
  return <Modal title={`请求移交 · ${node.title}`} onClose={onClose}>
    <Field label="原因"><select value={value.reason} onChange={(event) => update("reason", event.target.value)}>{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></Field>
    <Field label="证据与当前状态"><textarea className="goal" value={value.evidence} onChange={(event) => update("evidence", event.target.value)} /></Field>
    <Field label="建议接手"><select value={value.recommendedAgent} onChange={(event) => update("recommendedAgent", event.target.value)}><option value="codex">Codex</option><option value="claude">Claude</option></select></Field>
    <footer className="modal-actions"><button onClick={onClose}>取消</button><button className="danger" onClick={() => value.evidence.trim() && onSave({ taskId: task.id, nodeId: node.id, ...value, requestedBy: "control-plane" })}>停止并请求移交</button></footer>
  </Modal>;
}

function ReassignEditor({ task, node, onClose, onSave }) {
  const handoff = latestHandoff(node);
  const initialAgent = handoff?.recommendedAgent || (node.agent === "claude" ? "codex" : "claude");
  const [value, setValue] = useState({ targetAgent: initialAgent, executionMode: initialAgent === "claude" ? "claude-cli" : "codex-subagent", rationale: "", strategy: node.worktree ? "successor" : "restart", discardAttempt: false });
  const update = (key, next) => setValue((current) => ({ ...current, [key]: next }));
  const setAgent = (targetAgent) => setValue((current) => ({ ...current, targetAgent, executionMode: targetAgent === "claude" ? "claude-cli" : "codex-subagent" }));
  return <Modal title={`重新分配 · ${node.title}`} onClose={onClose}>
    <div className="form-grid two"><Field label="接手 Agent"><select value={value.targetAgent} onChange={(event) => setAgent(event.target.value)}><option value="codex">Codex</option><option value="claude">Claude</option></select></Field><Field label="执行模式"><select value={value.executionMode} onChange={(event) => update("executionMode", event.target.value)}>{value.targetAgent === "codex" ? <><option value="codex-lead">主线程</option><option value="codex-subagent">原生 subagent</option><option value="alignment">对齐 Agent</option></> : <><option value="claude-cli">Claude CLI</option><option value="alignment">对齐 Agent</option></>}</select></Field></div>
    <Field label="策略"><select value={value.strategy} onChange={(event) => update("strategy", event.target.value)}><option value="restart">清洁重启同一节点</option><option value="successor">建立后继节点并保留尝试</option></select></Field>
    {value.strategy === "restart" && node.worktree && <label className="checkbox danger-text"><input type="checkbox" checked={value.discardAttempt} onChange={(event) => update("discardAttempt", event.target.checked)} />明确删除现有隔离 worktree 尝试</label>}
    <Field label="重新分配理由"><textarea className="goal" value={value.rationale} onChange={(event) => update("rationale", event.target.value)} /></Field>
    <footer className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => value.rationale.trim() && onSave({ taskId: task.id, nodeId: node.id, ...value })}>完成移交</button></footer>
  </Modal>;
}

function Progress({ progress }) {
  if (!progress) return <div className="muted">尚无检查点</div>;
  return <div className="progress-block"><div className="progress-track"><i style={{ width: `${progress.percent ?? 0}%` }} /></div><div>{progress.summary || progress.phase}</div><small>上次 {formatTime(progress.checkpointAt || progress.at)} · 下次 {formatTime(progress.nextCheckAt)}</small></div>;
}

function NodeCard({ task, node, action }) {
  const handoff = latestHandoff(node);
  return <article className={`node-card status-${node.status}`}>
    <div className="node-head"><div><strong>{node.title}</strong><span className="badge">{node.status}</span></div><small>{node.id}</small></div>
    <p>{node.goal}</p>
    <dl><dt>职责</dt><dd>{node.role} · {node.execution?.mode || node.agent}</dd><dt>分配理由</dt><dd>{node.assignment?.rationale || "等待 Codex 说明"}</dd><dt>文件</dt><dd>{node.files?.length ? node.files.join(", ") : "未限定"}</dd><dt>约束</dt><dd>{node.constraints?.length ? node.constraints.join("；") : "无附加约束"}</dd></dl>
    <Progress progress={node.progress} />
    {handoff && <div className="handoff"><strong>{handoff.reason}</strong><span>{handoff.evidence}</span></div>}
    <div className="node-actions">
      {node.status === "planned" && node.agent === "claude" && <button className="primary" onClick={() => action("dispatch", task, node)}>派发 Claude</button>}
      {node.status === "planned" && node.agent === "codex" && <button className="primary" onClick={() => action("start-codex", task, node)}>请求 Codex 启动</button>}
      {["queued", "running"].includes(node.status) && <><button onClick={() => action("checkpoint", task, node)}>检查点</button><button className="danger" onClick={() => action("handoff", task, node)}>移交</button></>}
      {["handoff", "failed", "blocked"].includes(node.status) && <button className="primary" onClick={() => action("reassign", task, node)}>重新分配</button>}
      {node.status === "review" && node.agent === "claude" && <><button onClick={() => action("validate", task, node)}>重新验证</button><button className="primary" onClick={() => action("merge", task, node)}>审查并合并</button></>}
      {node.status === "review" && node.agent === "codex" && <><button className="danger" onClick={() => action("reject-codex", task, node)}>驳回</button><button className="primary" onClick={() => action("approve-codex", task, node)}>通过</button></>}
    </div>
  </article>;
}

function Lane({ title, nodes, task, action }) {
  return <section className="lane"><header><h3>{title}</h3><span>{nodes.length}</span></header><div className="lane-body">{nodes.length ? nodes.map((node) => <NodeCard key={node.id} task={task} node={node} action={action} />) : <div className="empty">暂无成员</div>}</div></section>;
}

function TaskCard({ task, action, openConstraints, addNode }) {
  const lanes = topologyLanes(task);
  return <section className="task-card">
    <header className="task-head"><div><h2>{task.title}</h2><p>{task.goal}</p></div><div className="task-actions"><span className={`task-status ${task.status}`}>{task.status}</span>{task.constraints?.status === "pending" && <button className="warn" onClick={() => openConstraints(task)}>填写或跳过约束</button>}<button onClick={() => addNode(task)}>添加成员</button></div></header>
    <div className="team-meta"><span>模式 {task.team?.mode}</span><span>检查周期 {task.team?.checkIntervalSeconds}s</span><span>约束 {task.constraints?.status}</span><span>双 Agent {task.team?.requireBothAgents ? "必须" : "按需"}</span></div>
    <div className="topology"><Lane title="Codex 开发" nodes={lanes.codex} task={task} action={action} /><Lane title="契约对齐" nodes={lanes.alignment} task={task} action={action} /><Lane title="Claude 开发" nodes={lanes.claude} task={task} action={action} /></div>
  </section>;
}

function BoardNodeCard({ item, action }) {
  const { task, node } = item;
  const kind = node.execution?.mode === "alignment" ? "ALIGN" : node.agent === "claude" ? "CLAUDE" : node.execution?.mode === "codex-subagent" ? "SUBAGENT" : "CODEX";
  const handoff = latestHandoff(node);
  return <article className={`board-card status-${node.status}`}>
    <div className="card-top"><span className={`agent-mark ${node.agent}`}>{kind}</span><span className="card-status">{node.status}</span></div>
    <h3>{node.title}</h3>
    <p>{node.goal}</p>
    <div className="card-context"><span>{task.title}</span><span>{node.role}</span></div>
    {node.progress && <div className="mini-progress"><i style={{ width: `${node.progress.percent ?? 0}%` }} /><span>{node.progress.summary || node.progress.phase}</span></div>}
    {handoff && <div className="card-alert"><b>{handoff.reason}</b><span>{handoff.evidence}</span></div>}
    <div className="card-foot"><span>{formatTime(node.updatedAt)}</span><span>{node.files?.length || 0} scopes</span></div>
    <div className="card-controls">
      {node.status === "planned" && node.agent === "claude" && <button onClick={() => action("dispatch", task, node)}>Dispatch</button>}
      {node.status === "planned" && node.agent === "codex" && <button onClick={() => action("start-codex", task, node)}>Start</button>}
      {["queued", "running"].includes(node.status) && <><button onClick={() => action("checkpoint", task, node)}>Checkpoint</button><button onClick={() => action("handoff", task, node)}>Handoff</button></>}
      {["handoff", "failed", "blocked"].includes(node.status) && <button onClick={() => action("reassign", task, node)}>Reassign</button>}
      {node.status === "review" && node.agent === "claude" && <><button onClick={() => action("validate", task, node)}>Validate</button><button onClick={() => action("merge", task, node)}>Merge</button></>}
      {node.status === "review" && node.agent === "codex" && <><button onClick={() => action("reject-codex", task, node)}>Reject</button><button onClick={() => action("approve-codex", task, node)}>Approve</button></>}
    </div>
  </article>;
}

function SetupCard({ task, openConstraints, addNode }) {
  return <article className="board-card setup-card"><div className="card-top"><span className="agent-mark setup">SETUP</span><span className="card-status">{task.constraints?.status}</span></div><h3>{task.title}</h3><p>{task.goal}</p><div className="card-controls visible">{task.constraints?.status === "pending" && <button onClick={() => openConstraints(task)}>Constraints</button>}<button onClick={() => addNode(task)}>Add member</button></div></article>;
}

const groupFor = (node) => ["queued", "running"].includes(node.status) ? "running" : ["handoff", "blocked", "failed"].includes(node.status) ? "blocked" : ["planned", "review"].includes(node.status) ? "ready" : "archived";

function App() {
  const [state, setState] = useState({ tasks: {}, events: [] });
  const [status, setStatus] = useState(null);
  const [nextActions, setNextActions] = useState([]);
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("board");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("any");
  const [showEvents, setShowEvents] = useState(false);
  const counts = useMemo(() => dashboardCounts(state), [state]);
  const tasks = useMemo(() => Object.values(state.tasks || {}), [state]);
  const items = useMemo(() => tasks.flatMap((task) => (task.nodes || []).map((node) => ({ task, node }))).filter(({ task, node }) => {
    const text = `${task.title} ${task.goal} ${node.title} ${node.goal} ${node.role}`.toLowerCase();
    const matchesQuery = !query.trim() || text.includes(query.trim().toLowerCase());
    const kind = node.execution?.mode === "alignment" ? "alignment" : node.agent;
    return matchesQuery && (agentFilter === "any" || kind === agentFilter) && groupFor(node) !== "archived";
  }), [tasks, query, agentFilter]);
  const groups = useMemo(() => ({ running: items.filter(({ node }) => groupFor(node) === "running"), blocked: items.filter(({ node }) => groupFor(node) === "blocked"), ready: items.filter(({ node }) => groupFor(node) === "ready") }), [items]);

  const refresh = useCallback(async () => {
    try {
      const [stateResult, statusResult, actionsResult] = await Promise.all([bridge.callTool("orchestrator_get_state"), bridge.callTool("claude_status"), bridge.callTool("orchestrator_get_next_actions")]);
      setState(structured(stateResult));
      setStatus(structured(statusResult));
      setNextActions(structured(actionsResult).actions || []);
    } catch (error) { setNotice({ error: true, text: error.message }); }
  }, []);

  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 2500); const unsubscribe = bridge.subscribeToolResults((value) => value?.tasks && setState(value)); return () => { window.clearInterval(timer); unsubscribe(); bridge.destroy(); }; }, [refresh]);

  const run = async (name, args, success) => {
    setBusy(true);
    try { await bridge.callTool(name, args); setNotice({ text: success }); setModal(null); await refresh(); }
    catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setBusy(false); }
  };

  const action = async (kind, task, node) => {
    if (kind === "dispatch") return run("orchestrator_dispatch_node", { taskId: task.id, nodeId: node.id }, "Claude 已在隔离 worktree 后台开工");
    if (kind === "start-codex") {
      try { await bridge.sendMessage(`请按混合团队 Skill 启动 Codex 节点 ${node.id}（任务 ${task.id}），执行模式 ${node.execution?.mode}。先调用 orchestrator_start_codex_node，再立即开展该节点，不要等待其他 Agent。`); setNotice({ text: "已请求 Codex 客户端启动原生开发节点" }); }
      catch (error) { setNotice({ error: true, text: error.message }); }
      return;
    }
    if (kind === "checkpoint") return setModal({ type: "checkpoint", task, node });
    if (kind === "handoff") return setModal({ type: "handoff", task, node });
    if (kind === "reassign") return setModal({ type: "reassign", task, node });
    if (kind === "validate") return run("orchestrator_validate_node", { taskId: task.id, nodeId: node.id }, "节点验证完成");
    if (kind === "merge") return run("orchestrator_merge_node", { taskId: task.id, nodeId: node.id }, "节点已合并");
    if (kind === "approve-codex") return run("orchestrator_review_codex_node", { taskId: task.id, nodeId: node.id, approved: true, note: "控制面确认通过" }, "Codex 节点已通过审查");
    if (kind === "reject-codex") return run("orchestrator_review_codex_node", { taskId: task.id, nodeId: node.id, approved: false, note: "控制面驳回" }, "Codex 节点已驳回");
  };

  const provider = status?.claude?.effectiveProvider === "gateway" ? `Gateway · ${status.claude.gateway?.baseUrlOrigin || "ready"}` : status?.claude?.effectiveProvider === "oauth" ? "OAuth" : status?.claude?.connected ? "Connected" : "Unavailable";
  const setupTasks = tasks.filter((task) => task.constraints?.status === "pending" || !(task.nodes || []).length);
  const openConstraints = (task) => setModal({ type: "constraints", task });
  const addNode = (task) => setModal({ type: "node", task });
  const agentFilters = ["any", "codex", "claude", "alignment"];
  const columns = [{ key: "running", title: "Running", count: groups.running.length }, { key: "blocked", title: "Blocked", count: groups.blocked.length }, { key: "ready", title: "Ready", count: groups.ready.length + setupTasks.length }];
  return <main className="devin-shell">
    <section className="board-toolbar"><div className="view-toggle"><button className={view === "board" ? "selected" : ""} onClick={() => setView("board")}>Board</button><button className={view === "list" ? "selected" : ""} onClick={() => setView("list")}>List</button></div><div className="toolbar-spacer" /><label className="session-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions..." /></label><button onClick={() => setShowEvents((value) => !value)}>Display⌄</button></section>
    <section className="filter-row"><button className="filter-chip">◷&nbsp; Time is&nbsp; <b>Any time</b>&nbsp; ×</button><button className="filter-chip">▤&nbsp; Archived is&nbsp; <b>Excluded</b>&nbsp; ×</button><button className="filter-chip" onClick={() => setAgentFilter(agentFilters[(agentFilters.indexOf(agentFilter) + 1) % agentFilters.length])}>◎&nbsp; Agent is&nbsp; <b>{agentFilter}</b></button><button className="add-filter" onClick={() => setModal({ type: "task" })}>＋</button><span className={`gateway-pill ${status?.claude?.connected ? "online" : ""}`}>Claude {provider}</span></section>
    {notice && <div className={`notice ${notice.error ? "error" : ""}`}><span>{notice.text}</span><button className="icon" onClick={() => setNotice(null)}>×</button></div>}
    {view === "board" ? <section className="session-board">
      {columns.map((column) => <section className={`status-column ${column.key}`} key={column.key}><header><div><span className="status-orbit" /><b>{column.title}</b><em>{column.count}</em></div>{column.key === "ready" && <button className="column-add" onClick={() => setModal({ type: "task" })}>＋</button>}</header><div className="column-cards">{column.key === "ready" && setupTasks.map((task) => <SetupCard key={task.id} task={task} openConstraints={openConstraints} addNode={addNode} />)}{groups[column.key].map((item) => <BoardNodeCard key={`${item.task.id}-${item.node.id}`} item={item} action={action} />)}{!column.count && <div className="column-empty">No sessions</div>}</div></section>)}
    </section> : <section className="session-list"><header><span>Session</span><span>Agent</span><span>Status</span><span>Updated</span></header>{items.map((item) => <button key={`${item.task.id}-${item.node.id}`} onClick={() => item.node.status === "planned" && action(item.node.agent === "claude" ? "dispatch" : "start-codex", item.task, item.node)}><span><b>{item.node.title}</b><small>{item.task.title}</small></span><span>{item.node.execution?.mode}</span><span>{item.node.status}</span><span>{formatTime(item.node.updatedAt)}</span></button>)}</section>}
    {showEvents && <aside className="activity-drawer"><section className="next-actions"><header><h2>Team loop</h2><span>{nextActions.length}</span></header>{nextActions.length ? nextActions.slice(0, 8).map((item, index) => <div key={`${item.type}-${item.nodeId || item.taskId}-${index}`}><b>P{item.priority}</b><span>{item.type}</span><small>{item.reason}</small></div>) : <p className="empty">No pending actions</p>}</section><section className="event-log"><header><h2>Events</h2><span>{counts.tasks} tasks · {counts.active} running · {counts.attention} attention</span></header>{(state.events || []).slice(-16).reverse().map((event) => <div key={event.id}><time>{formatTime(event.at)}</time><b>{eventLabel(event)}</b><span>{event.nodeId || event.taskId || ""}</span></div>)}</section></aside>}
    {!tasks.length && <div className="empty-overlay"><h2>No sessions yet</h2><p>Create a hybrid Codex × Claude team to begin.</p><button onClick={() => setModal({ type: "task" })}>New team</button></div>}
    {modal?.type === "task" && <TaskWizard onClose={() => setModal(null)} onCreate={(payload) => run("orchestrator_create_task", payload, "团队任务已创建")} />}
    {modal?.type === "constraints" && <ConstraintEditor task={modal.task} onClose={() => setModal(null)} onSave={(taskId, value, skip) => run("orchestrator_set_constraints", { taskId, ...taskCreationPayload({ goal: modal.task.goal, constraints: value }, skip).constraints }, skip ? "已跳过开发约束" : "开发约束已写入")} />}
    {modal?.type === "node" && <NodeWizard task={modal.task} onClose={() => setModal(null)} onCreate={(payload) => run("orchestrator_add_node", payload, "团队成员已添加")} />}
    {modal?.type === "checkpoint" && <CheckpointEditor task={modal.task} node={modal.node} onClose={() => setModal(null)} onSave={(payload) => run("orchestrator_checkpoint_node", payload, "检查点已记录")} />}
    {modal?.type === "handoff" && <HandoffEditor task={modal.task} node={modal.node} onClose={() => setModal(null)} onSave={(payload) => run("orchestrator_request_handoff", payload, "移交请求已记录")} />}
    {modal?.type === "reassign" && <ReassignEditor task={modal.task} node={modal.node} onClose={() => setModal(null)} onSave={(payload) => run("orchestrator_reassign_node", payload, "节点已重新分配")} />}
  </main>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
