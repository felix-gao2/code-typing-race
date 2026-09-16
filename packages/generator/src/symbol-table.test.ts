import { describe, expect, it } from 'vitest';
import { SymbolTable } from './symbol-table.ts';

describe('SymbolTable', () => {
  it('keeps outer declarations visible inside a nested scope', () => {
    const table = new SymbolTable();
    table.declare('count', 'int');
    table.push();
    table.declare('tag', 'string');

    expect(table.visible().map((v) => v.name)).toEqual(['count', 'tag']);
  });

  it('drops inner declarations when the scope pops', () => {
    const table = new SymbolTable();
    table.declare('count', 'int');
    table.push();
    table.declare('tag', 'string');
    table.pop();

    expect(table.visible().map((v) => v.name)).toEqual(['count']);
    expect(table.isVisible('tag')).toBe(false);
  });

  it('filters by type', () => {
    const table = new SymbolTable();
    table.declare('count', 'int');
    table.declare('rate', 'double');
    table.declare('total', 'int');

    expect(table.visibleOfType('int').map((v) => v.name)).toEqual(['count', 'total']);
    expect(table.visibleOfType('boolean')).toEqual([]);
  });

  it('refuses to shadow a visible name from an enclosing scope', () => {
    const table = new SymbolTable();
    table.declare('count', 'int');
    table.push();

    expect(() => table.declare('count', 'double')).toThrow(/no shadowing/);
  });

  it('refuses to redeclare within one scope', () => {
    const table = new SymbolTable();
    table.declare('count', 'int');

    expect(() => table.declare('count', 'int')).toThrow(/no shadowing/);
  });

  it('allows the same name again once the scope holding it is gone', () => {
    const table = new SymbolTable();
    table.push();
    table.declare('idx', 'int');
    table.pop();

    expect(() => table.declare('idx', 'string')).not.toThrow();
  });

  it('throws rather than silently emptying the stack', () => {
    const table = new SymbolTable();

    expect(() => table.pop()).toThrow(/root scope/);
  });
});
