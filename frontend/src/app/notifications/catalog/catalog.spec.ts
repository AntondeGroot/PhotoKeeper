import { CATALOG } from './catalog';
import { TEMPLATE_VARS } from '../notification-message';

describe('notification CATALOG', () => {
  it('has unique message ids', () => {
    const ids = CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every date message a date condition and every stat message a stat condition', () => {
    for (const m of CATALOG) {
      if (m.type === 'date') expect(m.date).toBeDefined();
      if (m.type === 'stat') expect(m.stat).toBeDefined();
      if (m.type === 'evergreen') expect(m.date ?? m.stat).toBeUndefined();
    }
  });

  it('only interpolates whitelisted {{vars}}', () => {
    const allowed = new Set<string>(TEMPLATE_VARS);
    for (const m of CATALOG) {
      for (const token of `${m.title} ${m.text}`.matchAll(/\{\{(\w+)\}\}/g)) {
        expect(allowed.has(token[1])).toBe(true);
      }
    }
  });
});
