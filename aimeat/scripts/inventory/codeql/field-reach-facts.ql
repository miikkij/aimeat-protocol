/**
 * @name Field reach facts: what REST handlers read, and which agent tools stand beside them
 * @description Five result sets, joined by scripts/inventory/field-reach.ts:
 *   - reads:  the top-level fields a REST handler reads from req.body and req.query, following the
 *             value through variables, casts, destructuring, function calls, a zod parse/safeParse, a
 *             spread copy and Object.assign. A computed key is named from the string constants that
 *             reach it (`resolved`); when none do the row stays, marked `unnamed`.
 *   - routes: each handler function and the METHOD and path it is registered on.
 *   - tools:  each agent tool (node MCP, connector MCP, CLI dispatch) and its handler function.
 *   - calls:  for each handler or tool, the functions in OTHER files it calls, directly or through
 *             helpers in its own file, and `storage.<method>` calls CodeQL cannot resolve.
 *   - http:   for each connector or CLI tool, the REST calls it makes (METHOD and a path pattern).
 *   A unit (handler or tool) is named by its function's location, `file:line:column`.
 * @id aimeat/inventory/field-reach-facts
 * @kind table
 */

import javascript

/** A function's name for the join: its location. */
string unitId(DataFlow::FunctionNode fn) {
  result = fn.getFile().getRelativePath() + ":" + fn.getStartLine() + ":" + fn.getStartColumn()
}

// ─────────────────────────────────────────────────────────── Routes

/**
 * A route registration: `router.get('/path', ...)` and its siblings, on any receiver.
 *
 * The Express model's own RouteSetup reads handlers by argument POSITION, and this codebase spreads
 * its middleware (`router.get(path, ...operator, async (req, res) => …)`), after which no position
 * is known. Measured 2026-09-14: eight route files produced no request at all under the model alone,
 * admin-memory.ts among them. So a registration is recognised by its shape instead: a verb method
 * whose first argument is a path.
 */
predicate routeRegistration(DataFlow::MethodCallNode call) {
  call.getMethodName() = ["get", "post", "put", "patch", "delete", "all", "use", "options", "head"] and
  (
    call.getArgument(0).getStringValue().matches("/%")
    or
    call.getArgument(0).asExpr() instanceof RegExpLiteral
    or
    call.getArgument(0).asExpr() instanceof ArrayExpr
  )
}

/**
 * A function given to a route registration, with the registration: directly, or through one
 * wrapper call (`router.put(path, ...auth, handle(async (req, res) => …))`, admin-features.ts).
 */
predicate routeHandler(DataFlow::FunctionNode handler, DataFlow::MethodCallNode call) {
  routeRegistration(call) and
  handler.getNumParameter() >= 2 and
  (
    handler.flowsTo(call.getAnArgument())
    or
    exists(DataFlow::CallNode wrap |
      wrap.flowsTo(call.getAnArgument()) and handler.flowsTo(wrap.getAnArgument())
    )
  )
}

/**
 * A parameter named `req` or `request` that no route handler's request reaches: a helper handed the
 * request through a callback (apps.ts passes `canonicalOwner = async (req) => …` to its sub-routers)
 * or a path-less middleware. Its reads are real; which door they belong to is not known, so they are
 * reported under `unrouted:` and counted as a blind spot rather than dropped.
 */
predicate strayRequest(DataFlow::ParameterNode req) {
  req.getName() = ["req", "request"] and
  req.getFile().getRelativePath().matches("src/%") and
  not routeHandler(any(DataFlow::FunctionNode h | req = h.getParameter(0)), _)
}

/** The request object, followed through variables and into the helpers it is passed to. */
module RequestObjectConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) {
    routeHandler(any(DataFlow::FunctionNode h | node = h.getParameter(0)), _) or strayRequest(node)
  }

  predicate isSink(DataFlow::Node node) {
    node = any(DataFlow::PropRead read | read.getPropertyName() = ["body", "query"]).getBase()
  }
}

module RequestObjectFlow = DataFlow::Global<RequestObjectConfig>;

/**
 * `req.body` or `req.query`, and the unit whose request it is: the route handler's location, or
 * `unrouted:` and the stray parameter's function when no route handler's request reaches it.
 */
predicate requestInput(DataFlow::PropRead input, string kind, string handler) {
  kind = ["body", "query"] and
  input.getPropertyName() = kind and
  (
    exists(DataFlow::FunctionNode h |
      routeHandler(h, _) and
      RequestObjectFlow::flow(h.getParameter(0), input.getBase()) and
      handler = unitId(h)
    )
    or
    not exists(DataFlow::FunctionNode h |
      routeHandler(h, _) and RequestObjectFlow::flow(h.getParameter(0), input.getBase())
    ) and
    exists(DataFlow::ParameterNode stray, DataFlow::FunctionNode owner |
      strayRequest(stray) and
      stray = owner.getAParameter() and
      RequestObjectFlow::flow(stray, input.getBase()) and
      handler = "unrouted:" + unitId(owner)
    )
  )
}

// ─────────────────────────────────────────────────────────── Reads

/** `schema.parse(x)`, `schema.parseAsync(x)`, `schema.safeParse(x)`, `schema.safeParseAsync(x)`. */
predicate schemaParse(DataFlow::MethodCallNode call, boolean safe) {
  call.getMethodName() = ["parse", "parseAsync"] and safe = false
  or
  call.getMethodName() = ["safeParse", "safeParseAsync"] and safe = true
}

/** The result object of a safeParse, awaited when it is the async one. */
DataFlow::SourceNode safeParseResult(DataFlow::MethodCallNode call) {
  schemaParse(call, true) and
  (
    result = call
    or
    exists(AwaitExpr await | await.getOperand().flow() = call and result = await.flow())
  )
}

module RequestInputConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { requestInput(node, _, _) }

  predicate isSink(DataFlow::Node node) { node = any(DataFlow::PropRead read).getBase() }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    // A parse hands back the value it was given, validated: `Schema.parse(req.body).name`.
    exists(DataFlow::MethodCallNode call |
      schemaParse(call, false) and pred = call.getArgument(0) and succ = call
    )
    or
    // A safeParse hands it back under `.data`.
    exists(DataFlow::MethodCallNode call |
      schemaParse(call, true) and
      pred = call.getArgument(0) and
      succ = safeParseResult(call).getAPropertyRead("data")
    )
    or
    // A copy carries the fields it copied: `engine.answer({ ...parsed.data, by })` is read as
    // `answer.picks` in another file. Without this the read was lost (measured on
    // routes/workflows.ts, 2026-09-14). The copy's own extra keys are counted too, which
    // overreports and is the safe direction.
    exists(ObjectExpr copy, SpreadProperty spread |
      spread = copy.getAProperty() and
      pred = spread.getInit().(SpreadElement).getOperand().flow() and
      succ = copy.flow()
    )
    or
    exists(MethodCallExpr assign |
      assign.getReceiver().(GlobalVarAccess).getName() = "Object" and
      assign.getMethodName() = "assign" and
      pred = assign.getArgument([1 .. assign.getNumArgument() - 1]).flow() and
      succ = assign.flow()
    )
  }
}

module RequestInputFlow = DataFlow::Global<RequestInputConfig>;

/** Reads that are the envelope of a safeParse result (`success`, `data`, `error`), not a request field. */
predicate safeParseEnvelope(DataFlow::PropRead read) {
  exists(DataFlow::MethodCallNode call | read = safeParseResult(call).getAPropertyRead())
}

/** A read of a request value whose property name is not a constant: `body[field]`. */
predicate dynamicRequestRead(DataFlow::PropRead read) {
  not exists(read.getPropertyName()) and
  exists(DataFlow::PropRead input |
    requestInput(input, _, _) and RequestInputFlow::flow(input, read.getBase())
  )
}

/**
 * The names a dynamic read is given, when they are string constants somewhere upstream:
 * `q('client_id')` inside `const q = (key) => req.query[key]`, or
 * `for (const k of ['agent_name', 'target_agent', 'agent']) body[k]`.
 */
module KeyNameConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) {
    node.asExpr().(StringLiteral).getValue().regexpMatch("[A-Za-z_][A-Za-z0-9_]*")
  }

  predicate isSink(DataFlow::Node node) {
    exists(DataFlow::PropRead read | dynamicRequestRead(read) and node = read.getPropertyNameExpr().flow())
  }
}

module KeyNameFlow = DataFlow::Global<KeyNameConfig>;

/** An expression with its casts, non-null assertions and parentheses taken off. */
Expr stripped(Expr e) {
  result = e and
  not e instanceof TypeAssertion and
  not e instanceof NonNullAssertion and
  not e instanceof ParExpr and
  not e instanceof SatisfiesExpr
  or
  result = stripped(e.(TypeAssertion).getExpression())
  or
  result = stripped(e.(NonNullAssertion).getExpression())
  or
  result = stripped(e.(ParExpr).getExpression())
  or
  result = stripped(e.(SatisfiesExpr).getExpression())
}

/** The object literal a constant names: `const FIELD_MAP: Record<string, string> = { … }`. */
ObjectExpr constObject(Expr e) {
  result = stripped(stripped(e).(VarAccess).getVariable().getAnAssignedExpr())
}

/**
 * The names a key takes when it is iterated out of a constant rather than passed as a literal:
 * `for (const [wire, rec] of Object.entries(FIELD_MAP)) body[wire]` (routes/companies.ts, the update
 * path Kalle's report was about) and `for (const key of PRESIGNED_META_KEYS[utype]) input[key]`
 * (services/upload-token.ts). Data flow does not carry an object's property NAMES, so these two
 * shapes are read off the syntax, and only when the constant is an object literal in plain sight.
 */
string iteratedKeyName(DataFlow::PropRead read) {
  exists(ForOfStmt loop, Variable key, Expr domain |
    read.getPropertyNameExpr() = key.getAnAccess() and
    domain = stripped(loop.getIterationDomain()) and
    (
      // for (const [k, v] of Object.entries(OBJ)) / for (const k of Object.keys(OBJ))
      exists(MethodCallExpr iterate, ObjectExpr obj |
        iterate = domain and
        iterate.getReceiver().(GlobalVarAccess).getName() = "Object" and
        obj = constObject(iterate.getArgument(0)) and
        (
          iterate.getMethodName() = "entries" and
          key = loop.getLValue().(ArrayPattern).getElement(0).(VarDecl).getVariable()
          or
          iterate.getMethodName() = "keys" and
          key = loop.getLValue().(VarDecl).getVariable()
        ) and
        result = obj.getAProperty().getName()
      )
      or
      // for (const k of OBJ_OF_ARRAYS[x])
      exists(IndexExpr pick, ObjectExpr obj |
        pick = domain and
        obj = constObject(pick.getBase()) and
        key = loop.getLValue().(VarDecl).getVariable() and
        result = stripped(obj.getAProperty().getInit()).(ArrayExpr).getAnElement().(StringLiteral).getValue()
      )
    )
  )
}

query predicate reads(
  string kind, string field, string naming, string file, int line, string handler
) {
  exists(DataFlow::PropRead input, DataFlow::PropRead read |
    requestInput(input, kind, handler) and
    RequestInputFlow::flow(input, read.getBase()) and
    not safeParseEnvelope(read) and
    // `delete patch[field]` removes what the caller sent; it is the route refusing a field, not
    // taking it (routes/capabilities.ts strips the server-owned fields this way).
    not read.asExpr().getParentExpr() instanceof DeleteExpr and
    file = read.getFile().getRelativePath() and
    line = read.getStartLine() and
    (
      field = read.getPropertyName() and naming = "constant"
      or
      not exists(read.getPropertyName()) and
      (
        exists(DataFlow::Node name |
          KeyNameFlow::flow(name, read.getPropertyNameExpr().flow()) and
          field = name.asExpr().(StringLiteral).getValue()
        )
        or
        field = iteratedKeyName(read)
      ) and
      naming = "resolved"
      or
      not exists(read.getPropertyName()) and
      not KeyNameFlow::flowTo(read.getPropertyNameExpr().flow()) and
      not exists(iteratedKeyName(read)) and
      field = "" and
      naming = "unnamed"
    )
  )
}

query predicate routes(string handler, string method, string path) {
  exists(DataFlow::FunctionNode h, DataFlow::MethodCallNode call |
    routeHandler(h, call) and
    handler = unitId(h) and
    method = call.getMethodName().toUpperCase() and
    path = call.getArgument(0).getStringValue()
  )
}

// ─────────────────────────────────────────────────────────── Tools

/** Which agent surface a file's tools belong to. */
string surfaceOfFile(File f) {
  f.getRelativePath().matches("src/cli/connect/mcp/%") and result = "mcp.connector"
  or
  f.getRelativePath().matches("src/cli/connect/%") and
  not f.getRelativePath().matches("src/cli/connect/mcp/%") and
  result = "cli.dispatch"
  or
  f.getRelativePath().matches("src/mcp/%") and result = "mcp.node"
}

/** `server.tool('aimeat_x', …, handler)` and `server.registerTool('aimeat_x', cfg, handler)`. */
predicate mcpTool(string surface, string name, DataFlow::FunctionNode handler) {
  exists(DataFlow::MethodCallNode call |
    call.getMethodName() = ["tool", "registerTool"] and
    name = call.getArgument(0).getStringValue() and
    name.matches("aimeat\\_%") and
    handler.flowsTo(call.getLastArgument()) and
    surface = surfaceOfFile(call.getFile()) and
    surface != "cli.dispatch"
  )
}

/** `{ name: 'aimeat_x', input: {…}, handler: (ctx, input) => … }` in the CLI dispatch tables. */
predicate cliTool(string name, DataFlow::FunctionNode handler) {
  exists(ObjectExpr def |
    surfaceOfFile(def.getFile()) = "cli.dispatch" and
    name = def.getPropertyByName("name").getInit().getStringValue() and
    name.matches("aimeat\\_%") and
    handler.flowsTo(def.getPropertyByName("handler").getInit().flow())
  )
}

predicate toolUnit(string surface, string name, DataFlow::FunctionNode handler) {
  mcpTool(surface, name, handler)
  or
  cliTool(name, handler) and surface = "cli.dispatch"
}

query predicate tools(string surface, string name, string handler) {
  exists(DataFlow::FunctionNode h | toolUnit(surface, name, h) and handler = unitId(h))
}

// ─────────────────────────────────────────────────────────── Calls

predicate unit(DataFlow::FunctionNode fn) { routeHandler(fn, _) or toolUnit(_, _, fn) }

/**
 * The function a call runs: one in its own file, or one imported by name.
 *
 * Not `InvokeNode.getACallee()`. Measured 2026-09-14 on this database it resolved nothing in
 * routes/companies.ts or mcp/companies.ts, neither `toInput` defined three lines up nor the imported
 * `updateCompany`, while data flow followed values through both. So the two cases are resolved by
 * hand: a function whose own invocations include the call, and an import specifier whose module
 * exports a function under that name.
 */
DataFlow::FunctionNode calleeOf(DataFlow::InvokeNode call) {
  call = result.getAnInvocation()
  or
  exists(ImportSpecifier spec, ImportDeclaration imp |
    spec = imp.getASpecifier() and
    call.getCalleeNode().getALocalSource() = DataFlow::valueNode(spec) and
    result = imp.getImportedModule().getAnExportedValue(spec.getImportedName()).getALocalSource()
  )
}

/** A call made inside `fn`, including inside functions nested in it. */
predicate callIn(DataFlow::InvokeNode call, DataFlow::FunctionNode fn) {
  call.getContainer().getEnclosingContainer*() = fn.getFunction()
}

/** The unit itself and every function in its own file it calls, transitively. */
DataFlow::FunctionNode localReach(DataFlow::FunctionNode u) {
  unit(u) and result = u
  or
  exists(DataFlow::FunctionNode mid, DataFlow::InvokeNode call |
    mid = localReach(u) and
    callIn(call, mid) and
    result = calleeOf(call) and
    result.getFile() = u.getFile()
  )
}

/** The receiver's own name: `storage` in `storage.x()`, `ctx.storage.x()` and `deps.storage.x()`. */
string receiverName(DataFlow::MethodCallNode call) {
  result = call.getReceiver().asExpr().(VarAccess).getName()
  or
  result = call.getReceiver().(DataFlow::PropRead).getPropertyName()
}

/**
 * Request data, as far as it goes: into objects built from it, strings made of it, and the arguments
 * of the calls it is handed to.
 */
module RequestTaintConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { requestInput(node, _, _) }

  predicate isSink(DataFlow::Node node) { node = any(DataFlow::InvokeNode call).getAnArgument() }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    exists(DataFlow::MethodCallNode call |
      schemaParse(call, _) and pred = call.getArgument(0) and succ = call
    )
  }
}

module RequestTaint = TaintTracking::Global<RequestTaintConfig>;

/**
 * A call a unit makes that counts toward pairing it with another unit.
 *
 * For a route handler, only a call the request's data reaches: `createCompany(storage, owner,
 * toInput(parsed.data))` counts and `companyAddress(config, company)` in the response does not.
 * Without this, every company tool that formats its answer with companyAddress became a twin of
 * every company route (measured 2026-09-14), and lent its declared input to doors it has nothing to
 * do with, which is the permissive direction. A tool's calls all count: its input arrives as
 * parameters the protocol hands it, not as a request object this query can follow.
 */
predicate pairingCall(DataFlow::FunctionNode u, DataFlow::InvokeNode call) {
  callIn(call, localReach(u)) and
  (
    toolUnit(_, _, u)
    or
    routeHandler(u, _) and carriesRequestData(call.getAnArgument().asExpr())
  )
}

/**
 * An argument that is request data, or is built around it: `createCompany(…, toInput(parsed.data))`
 * carries `parsed.data` inside a call, `{ organismId: body.organism_id }` carries a request field
 * inside an object. Taint tracking alone missed the first shape (the object toInput returns holds the
 * data as content, not as taint), and teaching it to (an implicit content read at the sink, or a step
 * from every object literal to its properties) took the evaluation from 15 s to over ten minutes on
 * 2026-09-14. Looking inside the argument's own expression is cheap and covers both, as long as the
 * argument is bound first: unbound, `getAChildExpr*` is every ancestor pair in the program, and that
 * ran past ten minutes too.
 */
bindingset[arg]
predicate carriesRequestData(Expr arg) {
  exists(Expr e | e = arg.getAChildExpr*() |
    RequestTaint::flowTo(e.flow())
    or
    requestInput(e.flow(), _, _)
    or
    RequestInputFlow::flowTo(e.flow().(DataFlow::PropRead).getBase())
  )
}

/**
 * The name a unit's call is paired by: a function in another file, or `storage.<method>`.
 *
 * Bound to the unit's own calls first. Written without that on 2026-09-14, the file inequality was
 * the only thing relating the unit to the call, and the evaluator built every function against every
 * call: the query went from 15 seconds to past ten minutes and nothing said why.
 */
string crossFileCallee(DataFlow::FunctionNode u, DataFlow::InvokeNode call) {
  callIn(call, localReach(u)) and
  (
    exists(DataFlow::FunctionNode f | f = calleeOf(call) and f.getFile() != u.getFile() |
      result = f.getFile().getRelativePath() + "#" + f.getStartLine()
    )
    or
    not exists(calleeOf(call)) and
    receiverName(call) = "storage" and
    result = "storage." + call.(DataFlow::MethodCallNode).getMethodName()
  )
}

query predicate calls(string unitName, string callee) {
  exists(DataFlow::FunctionNode u, DataFlow::InvokeNode call |
    unitName = unitId(u) and
    pairingCall(u, call) and
    callee = crossFileCallee(u, call)
  )
}

// ─────────────────────────────────────────────────────────── HTTP from tools

/** A path expression as a pattern: literal text kept, everything computed becomes `*`. */
string pathPattern(Expr e) {
  result = e.(StringLiteral).getValue()
  or
  e instanceof TemplateLiteral and
  result =
    concat(int i, string part |
      part = templatePart(e, i)
    |
      part order by i
    )
  or
  result = pathPattern(e.(AddExpr).getLeftOperand()) + pathPattern(e.(AddExpr).getRightOperand())
  or
  not e instanceof StringLiteral and
  not e instanceof TemplateLiteral and
  not e instanceof AddExpr and
  result = "*"
}

string templatePart(TemplateLiteral t, int i) {
  result = t.getElement(i).(TemplateElement).getRawValue()
  or
  not t.getElement(i) instanceof TemplateElement and exists(t.getElement(i)) and result = "*"
}

/** Every function a tool's handler reaches inside the connector and CLI code, any file. */
DataFlow::FunctionNode clientReach(DataFlow::FunctionNode u) {
  toolUnit(["mcp.connector", "cli.dispatch"], _, u) and result = u
  or
  exists(DataFlow::FunctionNode mid, DataFlow::InvokeNode call |
    mid = clientReach(u) and
    callIn(call, mid) and
    result = calleeOf(call) and
    result.getFile().getRelativePath().matches("src/cli/%")
  )
}

query predicate http(string unitName, string method, string path) {
  exists(DataFlow::FunctionNode u, DataFlow::MethodCallNode call, string m |
    unitName = unitId(u) and
    callIn(call, clientReach(u)) and
    m = call.getMethodName() and
    m = ["get", "post", "put", "patch", "delete"] and
    method = m.toUpperCase() and
    path = pathPattern(call.getArgument(0).asExpr()) and
    path.matches("/%")
  )
}
