import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import DOMPurify from 'isomorphic-dompurify';
import { ptCloseoutFormSchema } from '../../src/lib/invoices/ptCloseout';

describe('patched dependency compatibility', () => {
  it('returns field errors for invalid form input using Zod 4', async () => {
    const resolver = zodResolver(z.object({ email: z.string().email() }));
    const result = await resolver({ email: 'not-an-email' }, undefined, {
      fields: {}, shouldUseNativeValidation: false,
    });
    expect(result.errors.email?.type).toBe('invalid_format');
    expect(result.values).toEqual({});
  });

  it('preserves numeric form coercion and rejects negative payments', async () => {
    const resolver = zodResolver(ptCloseoutFormSchema);
    const result = await resolver({ reason: 'Approved correction', externalCommission: '1250.50' }, undefined, {
      fields: {}, shouldUseNativeValidation: false,
    });
    expect(result.values).toEqual({ reason: 'Approved correction', externalCommission: 1250.5 });
    expect(ptCloseoutFormSchema.safeParse({ reason: 'Approved correction', externalCommission: -1 }).success).toBe(false);
  });

  it('removes executable HTML while retaining safe formatting', () => {
    expect(DOMPurify.sanitize('<p>Safe <b>text</b></p><script>alert(1)</script><img src="x" onerror="alert(1)">'))
      .toBe('<p>Safe <b>text</b></p><img src="x">');
  });

  it('validates JSON-shaped member results without accepting non-JSON values', () => {
    const rows = z.array(z.record(z.string(), z.json()));
    expect(rows.parse([{ id: 'member-1', status: null, active: true }])).toEqual([{ id: 'member-1', status: null, active: true }]);
    expect(rows.safeParse([{ id: 'member-1', invalid: () => {} }]).success).toBe(false);
  });
});