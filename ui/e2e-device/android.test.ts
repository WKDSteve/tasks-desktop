// The choice of the phone for the device suite (`pickDevice`): one phone on the cable and over the network at once is
// one device, by its USB entry; two phones still need ANDROID_SERIAL.
import { describe, expect, it } from 'vitest';
import { isNetworkSerial, pickDevice } from './android.ts';

/** The serial numbers the entries stand for: the Fairphone over USB and over Tailscale, and a second phone. */
const phones: Record<string, string> = {
  bd30fe6f: 'FP5-1',
  '100.114.201.106:5555': 'FP5-1',
  'emulator-5554': 'EMU-1',
};
const serialOf = (entry: string) => phones[entry] ?? null;

describe('the phone of the device suite', () => {
  it('tells an entry over the network from one over USB', () => {
    expect(isNetworkSerial('100.114.201.106:5555')).toBe(true);
    expect(isNetworkSerial('[fd7a:115c::1]:5555')).toBe(true);
    expect(isNetworkSerial('bd30fe6f')).toBe(false);
    expect(isNetworkSerial('emulator-5554')).toBe(false);
    expect(isNetworkSerial('adb-bd30fe6f-Ab12Cd._adb-tls-connect._tcp')).toBe(true);
  });

  it('takes one phone on the cable and over the network as one device, by its USB entry, in either order', () => {
    expect(pickDevice(['bd30fe6f', '100.114.201.106:5555'], undefined, serialOf)).toEqual({ serial: 'bd30fe6f' });
    expect(pickDevice(['100.114.201.106:5555', 'bd30fe6f'], undefined, serialOf)).toEqual({ serial: 'bd30fe6f' });
  });

  it('takes the USB entry over the wireless debugging of Android 11+ as well', () => {
    const wireless = 'adb-bd30fe6f-Ab12Cd._adb-tls-connect._tcp';
    const of = (entry: string) => (entry === wireless ? 'FP5-1' : serialOf(entry));
    expect(pickDevice([wireless, 'bd30fe6f'], undefined, of)).toEqual({ serial: 'bd30fe6f' });
  });

  it('takes the network entry when it is the only one (the cable is off)', () => {
    expect(pickDevice(['100.114.201.106:5555'], undefined, serialOf)).toEqual({ serial: '100.114.201.106:5555' });
  });

  it('skips two phones without ANDROID_SERIAL, and takes the one it names', () => {
    const two = ['bd30fe6f', '100.114.201.106:5555', 'emulator-5554'];
    expect(pickDevice(two, undefined, serialOf)).toEqual({
      skip: '2 devices are connected: set ANDROID_SERIAL to the one to test on',
    });
    expect(pickDevice(two, 'emulator-5554', serialOf)).toEqual({ serial: 'emulator-5554' });
    expect(pickDevice(two, 'nope', serialOf)).toEqual({ skip: 'ANDROID_SERIAL nope is not connected' });
  });

  it('keeps an entry whose serial number cannot be read as a device of its own, and skips with none', () => {
    expect(pickDevice(['bd30fe6f', 'unknown-1'], undefined, serialOf)).toEqual({
      skip: '2 devices are connected: set ANDROID_SERIAL to the one to test on',
    });
    expect(pickDevice([], undefined, serialOf)).toEqual({
      skip: 'no Android device with USB debugging is connected (adb devices)',
    });
  });
});
