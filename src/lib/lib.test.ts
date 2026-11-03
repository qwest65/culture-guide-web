import { describe, expect, it } from 'vitest';
import { detectCity } from './geo';
import { countOf, formatDistance, formatDuration, formatHistDate } from './format';
import { routeDurationMinutes } from './estimate';

const troitsk = {
  id: 'troitsk',
  center: { lat: 54.082, lon: 61.5596 },
  bbox: { south: 53.992, west: 61.406, north: 54.172, east: 61.713 },
};
const chelyabinsk = {
  id: 'chelyabinsk',
  center: { lat: 55.16, lon: 61.4 },
  bbox: { south: 55.0, west: 61.2, north: 55.3, east: 61.6 },
};

describe('detectCity', () => {
  it('находит город, в районе которого человек стоит', () => {
    expect(detectCity([chelyabinsk, troitsk], { lat: 54.08, lon: 61.56 })?.id).toBe('troitsk');
  });
  it('предлагает ближайший город, если рядом с ним', () => {
    expect(detectCity([troitsk], { lat: 54.2, lon: 61.56 })?.id).toBe('troitsk'); // ~13 км от центра
  });
  it('не предлагает город за сотни километров', () => {
    expect(detectCity([troitsk, chelyabinsk], { lat: 55.75, lon: 37.62 })).toBeNull(); // Москва
  });
});

describe('format', () => {
  it('расстояния', () => {
    expect(formatDistance(7.2)).toBe('7 м');
    expect(formatDistance(231)).toBe('230 м');
    expect(formatDistance(1234)).toBe('1,2 км');
  });
  it('длительность', () => {
    expect(formatDuration(45)).toBe('45 мин');
    expect(formatDuration(60)).toBe('1 ч');
    expect(formatDuration(95)).toBe('1 ч 35 мин');
  });
  it('склонение', () => {
    expect(countOf(1, 'объект', 'объекта', 'объектов')).toBe('1 объект');
    expect(countOf(4, 'маршрут', 'маршрута', 'маршрутов')).toBe('4 маршрута');
    expect(countOf(11, 'объект', 'объекта', 'объектов')).toBe('11 объектов');
    expect(countOf(22, 'объект', 'объекта', 'объектов')).toBe('22 объекта');
  });
  it('исторические даты', () => {
    expect(formatHistDate('1743-05-22')).toBe('22 мая 1743');
    expect(formatHistDate('2019-11')).toBe('ноябрь 2019');
    expect(formatHistDate('1908/1910')).toBe('1908–1910');
    expect(formatHistDate('XVIII')).toBe('XVIII век');
  });
});

describe('estimate', () => {
  it('длительность кратна 5 минутам и учитывает рассказы', () => {
    const walkOnly = routeDurationMinutes(1400, [0, 0]); // 20 мин ходьбы + 4 мин остановок
    expect(walkOnly).toBe(25);
    expect(routeDurationMinutes(1400, [1680, 1680])).toBe(30); // + 2 × 2 мин рассказа
  });
});
