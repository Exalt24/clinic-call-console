import * as fs from 'node:fs';
import * as ts from 'typescript';

/**
 * Reads the Angular client's own wire types (web/src/app/core/models.ts) with the TypeScript compiler and checks a JSON
 * value against one of them: every required field present, every field the right primitive, every union member legal,
 * and (unless told otherwise) no field the client does not declare. The expected shape comes from the client's source, so
 * a rename there fails the contract test instead of passing against a hand-copied copy.
 */
export class ClientTypes {
  private readonly aliases = new Map<string, ts.TypeNode>();
  private readonly interfaces = new Map<string, ts.InterfaceDeclaration>();

  constructor(file: string) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
    sf.forEachChild((n) => {
      if (ts.isTypeAliasDeclaration(n)) this.aliases.set(n.name.text, n.type);
      if (ts.isInterfaceDeclaration(n)) this.interfaces.set(n.name.text, n);
    });
  }

  names(): string[] {
    return [...this.aliases.keys(), ...this.interfaces.keys()];
  }

  /** Returns the list of problems; an empty list means the value matches. `typeText` may be e.g. "Page<AuditRow>". */
  check(typeText: string, value: unknown, opts: { allowExtra?: boolean } = {}): string[] {
    const node = ts.createSourceFile('t.ts', `type T = ${typeText};`, ts.ScriptTarget.ES2022, true).statements[0] as ts.TypeAliasDeclaration;
    const errors: string[] = [];
    this.visit(node.type, value, '$', new Map(), errors, !!opts.allowExtra);
    return errors;
  }

  private visit(node: ts.TypeNode, value: unknown, path: string, bindings: Map<string, ts.TypeNode>, errors: string[], allowExtra: boolean): void {
    const here = (msg: string) => errors.push(`${path}: ${msg}`);
    switch (node.kind) {
      case ts.SyntaxKind.StringKeyword:
        if (typeof value !== 'string') here(`expected string, got ${describe(value)}`);
        return;
      case ts.SyntaxKind.NumberKeyword:
        if (typeof value !== 'number') here(`expected number, got ${describe(value)}`);
        return;
      case ts.SyntaxKind.BooleanKeyword:
        if (typeof value !== 'boolean') here(`expected boolean, got ${describe(value)}`);
        return;
    }
    if (ts.isParenthesizedTypeNode(node)) return this.visit(node.type, value, path, bindings, errors, allowExtra);
    if (ts.isLiteralTypeNode(node)) {
      const lit = node.literal;
      const want = lit.kind === ts.SyntaxKind.NullKeyword ? null : ts.isStringLiteral(lit) ? lit.text : undefined;
      if (value !== want) here(`expected ${JSON.stringify(want)}, got ${describe(value)}`);
      return;
    }
    if (ts.isUnionTypeNode(node)) {
      const attempts = node.types.map((member) => {
        const sub: string[] = [];
        this.visit(member, value, path, bindings, sub, allowExtra);
        return sub;
      });
      if (!attempts.some((a) => a.length === 0)) here(`matches no member of the union ${node.getText()} (got ${describe(value)})`);
      return;
    }
    if (ts.isArrayTypeNode(node)) {
      if (!Array.isArray(value)) return here(`expected an array, got ${describe(value)}`);
      value.forEach((item, i) => this.visit(node.elementType, item, `${path}[${i}]`, bindings, errors, allowExtra));
      return;
    }
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText();
      const bound = bindings.get(name);
      if (bound) return this.visit(bound, value, path, bindings, errors, allowExtra);
      const alias = this.aliases.get(name);
      if (alias) return this.visit(alias, value, path, bindings, errors, allowExtra);
      const decl = this.interfaces.get(name);
      if (!decl) return here(`the client declares no type named ${name}`);
      const inner = new Map(bindings);
      (decl.typeParameters ?? []).forEach((p, i) => {
        const arg = node.typeArguments?.[i];
        if (arg) inner.set(p.name.text, arg);
      });
      return this.visitInterface(decl, value, path, inner, errors, allowExtra);
    }
    here(`the contract test does not understand the type ${node.getText()}`);
  }

  private visitInterface(decl: ts.InterfaceDeclaration, value: unknown, path: string, bindings: Map<string, ts.TypeNode>, errors: string[], allowExtra: boolean): void {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected an object for ${decl.name.text}, got ${describe(value)}`);
      return;
    }
    const obj = value as Record<string, unknown>;
    const declared = new Set<string>();
    for (const m of decl.members) {
      if (!ts.isPropertySignature(m) || !m.type) continue;
      const key = m.name.getText();
      declared.add(key);
      if (!(key in obj)) {
        if (!m.questionToken) errors.push(`${path}.${key}: required by the client, missing from the response`);
        continue;
      }
      this.visit(m.type, obj[key], `${path}.${key}`, bindings, errors, allowExtra);
    }
    if (!allowExtra) {
      for (const key of Object.keys(obj)) if (!declared.has(key)) errors.push(`${path}.${key}: the response carries a field the client does not declare`);
    }
  }
}

function describe(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'string' ? JSON.stringify(v) : typeof v;
}
