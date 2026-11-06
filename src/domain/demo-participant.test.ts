import { describe, expect, it } from 'vitest';
import { cookieValue, demoParticipantName } from './demo-participant';

describe('demoParticipantName', () => {
  it('uses the sign-in cleaning rules and keeps the cleaned spelling for display', () => {
    expect(demoParticipantName('  Aino \t Virtanen ')).toEqual({
      ok: true,
      canonicalUsername: 'aino virtanen',
      displayName: 'Aino Virtanen',
    });
  });

  it('treats case, width and spacing variants as one participant', () => {
    for (const name of ['aino', ' AINO ', 'ＡＩＮＯ', 'Aino\u0000'])
      expect(demoParticipantName(name)).toMatchObject({ ok: true, canonicalUsername: 'aino' });
  });

  it('treats an ideographic space like an ordinary one', () => {
    expect(demoParticipantName('Maija\u3000\u3000Haapala')).toMatchObject({
      canonicalUsername: 'maija haapala',
    });
  });

  it('refuses the names the sign-in page refuses', () => {
    expect(demoParticipantName('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(demoParticipantName('a'.repeat(61))).toEqual({ ok: false, reason: 'too_long' });
    expect(demoParticipantName('a'.repeat(60))).toMatchObject({ ok: true });
  });
});

describe('cookieValue', () => {
  it('reads only the exact cookie and decodes it', () => {
    expect(cookieValue('theme=dark; lease-loop-name=Aino%20Virtanen', 'lease-loop-name')).toBe(
      'Aino Virtanen'
    );
    expect(cookieValue('other-lease-loop-name=x', 'lease-loop-name')).toBeNull();
  });

  it('treats missing, empty and malformed values as no cookie', () => {
    expect(cookieValue(null, 'lease-loop-name')).toBeNull();
    expect(cookieValue('', 'lease-loop-name')).toBeNull();
    expect(cookieValue('lease-loop-name=', 'lease-loop-name')).toBeNull();
    expect(cookieValue('lease-loop-name=%', 'lease-loop-name')).toBeNull();
    expect(cookieValue('lease-loop-name', 'lease-loop-name')).toBeNull();
  });

  it('uses the last copy when the header repeats the cookie', () => {
    expect(cookieValue('lease-loop-name=a; lease-loop-name=b', 'lease-loop-name')).toBe('b');
  });
});
