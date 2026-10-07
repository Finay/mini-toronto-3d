import { describe, expect, it } from 'vitest';
import { parseCameraList } from './torontoCameras';

const wrap = (data: object[]) => `jsonTMCEarthCamerasCallback({"Data":${JSON.stringify(data)}});`;

describe('parseCameraList', () => {
  it('reads cameras out of the callback wrapper', () => {
    const text = wrap([
      { Number: '8001', Name: 'YORK ST & BREMNER BLVD', Latitude: '43.643120', Longitude: '-79.381386', D1: 'n', Group: 'Arterial' },
    ]);

    expect(parseCameraList(text)).toEqual([
      {
        id: '8001',
        name: 'YORK ST & BREMNER BLVD',
        lat: 43.64312,
        lon: -79.381386,
        group: 'Arterial',
        imageUrl: 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc8001.jpg',
      },
    ]);
  });

  it('skips entries whose number or position cannot be used', () => {
    const text = wrap([
      { Number: '../x', Name: 'Bad number', Latitude: '43.6', Longitude: '-79.3' },
      { Number: '8002', Name: 'No position', Latitude: '', Longitude: 'east' },
      { Number: '8003', Name: 'Fine', Latitude: '43.6', Longitude: '-79.3' },
    ]);

    expect(parseCameraList(text).map((camera) => camera.id)).toEqual(['8003']);
  });

  it('rejects text that is not the wrapped list', () => {
    expect(() => parseCameraList('<html>Not found</html>')).toThrow();
  });
});
