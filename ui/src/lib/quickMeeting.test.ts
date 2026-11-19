// The quick line of a meeting in the palette: offered for a line that could name a time, not for every search.
import { describe, expect, it } from 'vitest';
import { make, snapshot } from './appDouble';
import { task } from './fixtures';
import { looksLikeMeeting, quickMeetingAction } from './paletteActions';

describe('the quick line of a meeting', () => {
  it('looks like a meeting with a digit or a word of a day, not with words alone', () => {
    for (const line of ['24.11. 9:30 Workshop', 'Sync 14:00', 'morgen ganztägig Schulung', 'Mo Sync', 'tomorrow standup', 'Fr. Retro']) {
      expect(looksLikeMeeting(line), line).toBe(true);
    }
    for (const line of ['qqqqzzzz', 'Export: Save as JSON', 'board', 'monday-ish thing']) expect(looksLikeMeeting(line), line).toBe(false);
  });

  it('is offered only for such a line, and only by an engine that reads one', async () => {
    const m = make({ token: 't' });
    m.hub.capabilities = ['meetings', 'meeting', 'meeting_ops', 'meeting_parse'];
    m.hub.doc = snapshot([task('pub/a', {})]);
    await m.app.start(null);
    m.app.stop();
    expect(quickMeetingAction(m.app, 'qqqqzzzz')).toBeNull();
    expect(quickMeetingAction(m.app, 'Mo')).toBeNull();
    expect(quickMeetingAction(m.app, 'Mo 14:00 Sync')?.key).toBe('meeting.quick');

    const without = make({ token: 't' });
    without.hub.capabilities = ['meetings', 'meeting', 'meeting_ops'];
    await without.app.start(null);
    without.app.stop();
    expect(quickMeetingAction(without.app, 'Mo 14:00 Sync')).toBeNull();
  });
});
