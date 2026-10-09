/**
 * A safe arithmetic evaluator for the assistant's `calculate` tool.
 *
 * Language models are unreliable at arithmetic — they will confidently state
 * that 37% of $48,250 is $17,952 — so any figure the assistant derives rather
 * than reads (growth, projections, averages of averages, what-ifs) goes
 * through here. A hand-written recursive-descent parser: no `eval`, no
 * `Function`, no property access — numbers, operators, and a fixed list of
 * functions are the entire language.
 *
 * Grammar (lowest precedence first):
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/" | "%") unary)*
 *   unary   := ("-" | "+") unary | power
 *   power   := primary ("^" unary)?          — right-associative; -2^2 = -4
 *   primary := number | name | name "(" args ")" | "(" expr ")"
 */

export class CalcError extends Error {}

const MAX_LENGTH = 500;
const MAX_DEPTH = 64;

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const nums = (fn: string, args: number[], min: number, max = min): number[] => {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : `${min}–${max}`;
    throw new CalcError(`${fn}() takes ${want} argument${max === 1 ? "" : "s"}, got ${args.length}.`);
  }
  return args;
};

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  abs: (a) => Math.abs(nums("abs", a, 1)[0]),
  sqrt: (a) => Math.sqrt(nums("sqrt", a, 1)[0]),
  cbrt: (a) => Math.cbrt(nums("cbrt", a, 1)[0]),
  floor: (a) => Math.floor(nums("floor", a, 1)[0]),
  ceil: (a) => Math.ceil(nums("ceil", a, 1)[0]),
  round: (a) => {
    const [x, digits = 0] = nums("round", a, 1, 2);
    const f = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)));
    return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
  },
  log: (a) => Math.log(nums("log", a, 1)[0]),
  ln: (a) => Math.log(nums("ln", a, 1)[0]),
  log10: (a) => Math.log10(nums("log10", a, 1)[0]),
  log2: (a) => Math.log2(nums("log2", a, 1)[0]),
  exp: (a) => Math.exp(nums("exp", a, 1)[0]),
  pow: (a) => {
    const [x, y] = nums("pow", a, 2);
    return x ** y;
  },
  min: (a) => Math.min(...nums("min", a, 1, 1000)),
  max: (a) => Math.max(...nums("max", a, 1, 1000)),
  sum: (a) => nums("sum", a, 1, 1000).reduce((s, x) => s + x, 0),
  avg: (a) => nums("avg", a, 1, 1000).reduce((s, x) => s + x, 0) / a.length,
};

type Token = { kind: "num"; value: number } | { kind: "name"; value: string } | { kind: "op"; value: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new CalcError(`Unreadable number at position ${i + 1}.`);
      tokens.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ kind: "name", value: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    if ("+-*/%^(),".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "$") {
      // "$1200" is how a model naturally writes money; the sign carries no meaning here.
      i++;
      continue;
    }
    throw new CalcError(`Unexpected "${ch}" at position ${i + 1}. Use numbers, + - * / % ^, parentheses and functions like round(x, 2).`);
  }
  return tokens;
}

export function evaluate(expression: string): number {
  if (typeof expression !== "string" || !expression.trim()) throw new CalcError("Empty expression.");
  if (expression.length > MAX_LENGTH) throw new CalcError(`Expression longer than ${MAX_LENGTH} characters.`);
  // Thousands separators ("48,250") are accepted only in an expression that
  // calls no function: once a call is present, a comma may be separating its
  // arguments, and guessing would silently change the answer.
  const src = /[A-Za-z_]\s*\(/.test(expression) ? expression : expression.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const tokens = tokenize(src);
  let pos = 0;
  let depth = 0;

  const peek = (): Token | undefined => tokens[pos];
  const isOp = (v: string) => peek()?.kind === "op" && peek()!.value === v;
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new CalcError(`Expected "${v}"${peek() ? ` near token ${pos + 1}` : " at the end"}.`);
    pos++;
  };
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new CalcError("Expression nested too deeply.");
  };

  function expr(): number {
    enter();
    let v = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].value;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    depth--;
    return v;
  }

  function term(): number {
    let v = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = tokens[pos++].value;
      const r = unary();
      if ((op === "/" || op === "%") && r === 0) throw new CalcError("Division by zero.");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }

  function unary(): number {
    if (isOp("-")) {
      pos++;
      enter();
      const v = -unary();
      depth--;
      return v;
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  }

  function power(): number {
    const base = primary();
    if (isOp("^")) {
      pos++;
      enter();
      const exp = unary();
      depth--;
      return base ** exp;
    }
    return base;
  }

  function primary(): number {
    const t = peek();
    if (!t) throw new CalcError("The expression ends too early.");
    if (t.kind === "num") {
      pos++;
      return t.value;
    }
    if (t.kind === "name") {
      pos++;
      if (isOp("(")) {
        // Own properties only: `in`/indexing would walk the prototype chain
        // and find `constructor`, `toString`…
        const fn = Object.hasOwn(FUNCTIONS, t.value) ? FUNCTIONS[t.value] : undefined;
        if (!fn) throw new CalcError(`Unknown function "${t.value}". Available: ${Object.keys(FUNCTIONS).join(", ")}.`);
        pos++;
        const args: number[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            pos++;
            args.push(expr());
          }
        }
        expectOp(")");
        return fn(args);
      }
      if (Object.hasOwn(CONSTANTS, t.value)) return CONSTANTS[t.value];
      throw new CalcError(`Unknown name "${t.value}". Only numbers, pi and e can be used — no variables.`);
    }
    if (t.value === "(") {
      pos++;
      const v = expr();
      expectOp(")");
      return v;
    }
    throw new CalcError(`Unexpected "${t.value}".`);
  }

  const result = expr();
  if (pos < tokens.length) throw new CalcError(`Unexpected "${String(tokens[pos].value)}" after a complete expression.`);
  if (!Number.isFinite(result)) throw new CalcError("The result is not a finite number.");
  return result;
}
