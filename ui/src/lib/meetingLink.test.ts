import { describe, expect, it } from 'vitest';
import { joinLink, MAX_JOIN_LINK } from './meetingLink';

describe('joinLink', () => {
  it('opens an https address of a service as it is', () => {
    expect(joinLink('https://teams.microsoft.com/l/meetup-join/abc%40thread?context=x')).toBe(
      'https://teams.microsoft.com/l/meetup-join/abc%40thread?context=x',
    );
    expect(joinLink('  https://meet.google.com/abc-defg-hij ')).toBe('https://meet.google.com/abc-defg-hij');
    expect(joinLink('HTTPS://zoom.us/j/123')).toBe('https://zoom.us/j/123');
  });

  it('opens nothing that is not https with a host', () => {
    for (const bad of [
      'http://teams.microsoft.com/l/x',
      'msteams:/l/meetup-join/abc',
      'zoommtg://zoom.us/join?confno=1',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///C:/secret.txt',
      '//evil.example/x',
      'teams.microsoft.com/l/x',
      'https://',
      'https://user:pw@evil.example/',
      'https://evil.example/\nhttps://teams.microsoft.com',
      'https://evil.example/ x',
      'https://evil.example/\u0000',
      '',
      `https://a.example/${'x'.repeat(MAX_JOIN_LINK)}`,
    ]) {
      expect(joinLink(bad), bad).toBeNull();
    }
    for (const notText of [undefined, null, 42, ['https://a.example/'], { href: 'https://a.example/' }]) {
      expect(joinLink(notText)).toBeNull();
    }
  });
});
