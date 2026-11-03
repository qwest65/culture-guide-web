import { describe, expect, it } from 'vitest';
import { distanceMeters } from './geo';
import { arriveManually, initialGuidance, remainingMeters, updateGuidance, type Fix, type Stop } from './guidance';

// Точки маршрута «Исторический центр» (Троицк): камень крепости, собор, площадь.
const stone: Stop = { lat: 54.077456, lon: 61.556294 };
const cathedral: Stop = { lat: 54.077776, lon: 61.557391 };
const square: Stop = { lat: 54.082807, lon: 61.559144 };
const stops = [stone, cathedral, square];

const at = (p: { lat: number; lon: number }, time: number, accuracyM = 8): Fix => ({ ...p, time, accuracyM });
const north = (p: Stop, dLat: number) => ({ lat: p.lat + dLat, lon: p.lon });

describe('updateGuidance', () => {
  it('вдали от цели держит цель и сообщает расстояние', () => {
    const u = updateGuidance(stops, initialGuidance(), at({ lat: 54.07, lon: 61.55 }, 0));
    expect(u.state.active).toBe(0);
    expect(u.reached).toEqual([]);
    expect(u.distanceM!).toBeGreaterThan(800);
    expect(u.finished).toBe(false);
  });

  it('прибытие засчитывается только через 5 секунд в радиусе', () => {
    const near = north(stone, 0.00027); // ~30 м
    let u = updateGuidance(stops, initialGuidance(), at(near, 0));
    expect(u.state.active).toBe(0);
    expect(u.reached).toEqual([]);
    u = updateGuidance(stops, u.state, at(near, 4000));
    expect(u.state.active).toBe(0);
    u = updateGuidance(stops, u.state, at(near, 5000));
    expect(u.reached).toEqual([0]);
    expect(u.state.active).toBe(1);
    expect(u.distanceM!).toBeCloseTo(distanceMeters(near, cathedral), 2);
  });

  it('одиночный скачок GPS к точке не даёт прибытия', () => {
    const far = north(stone, 0.003); // ~330 м
    let u = updateGuidance(stops, initialGuidance(), at(far, 0));
    u = updateGuidance(stops, u.state, at(stone, 1000)); // скачок
    u = updateGuidance(stops, u.state, at(far, 2000));
    u = updateGuidance(stops, u.state, at(far, 7000));
    expect(u.state.active).toBe(0);
    expect(u.reached).toEqual([]);
  });

  it('чуть дальше радиуса — не прибытие', () => {
    const outside = north(stone, 0.00054); // ~60 м
    let u = updateGuidance(stops, initialGuidance(), at(outside, 0));
    u = updateGuidance(stops, u.state, at(outside, 10000));
    expect(u.state.active).toBe(0);
  });

  it('неточная отметка не переключает цель и не сбрасывает ожидание', () => {
    let u = updateGuidance(stops, initialGuidance(), at(stone, 0));
    u = updateGuidance(stops, u.state, at(stone, 3000, 250));
    expect(u.state.active).toBe(0);
    expect(u.distanceM!).toBeLessThan(1);
    u = updateGuidance(stops, u.state, at(stone, 5000));
    expect(u.state.active).toBe(1);
  });

  it('срезанный путь: пропущенные точки засчитываются', () => {
    let u = updateGuidance(stops, initialGuidance(), at(cathedral, 0, 5));
    u = updateGuidance(stops, u.state, at(cathedral, 5000, 5));
    expect(u.reached).toEqual([0, 1]);
    expect(u.state.active).toBe(2);
  });

  it('свой радиус у точки важнее общего', () => {
    const wide: Stop[] = [{ ...stone, radiusM: 100 }, cathedral];
    const p = north(stone, 0.0007); // ~78 м
    let u = updateGuidance(wide, initialGuidance(), at(p, 0));
    u = updateGuidance(wide, u.state, at(p, 5000));
    expect(u.state.active).toBe(1);
  });

  it('последняя точка завершает маршрут', () => {
    let u = updateGuidance(stops, initialGuidance(2), at(square, 0, 5));
    u = updateGuidance(stops, u.state, at(square, 5000, 5));
    expect(u.finished).toBe(true);
    expect(u.state.active).toBe(3);
    expect(u.distanceM).toBeNull();
  });
});

describe('arriveManually', () => {
  it('«Я на месте» переключает на следующую точку', () => {
    const u = arriveManually(stops, initialGuidance(1));
    expect(u.reached).toEqual([1]);
    expect(u.state.active).toBe(2);
    expect(arriveManually(stops, u.state).finished).toBe(true);
  });
});

describe('remainingMeters', () => {
  it('складывает расстояние до цели и следующие участки', () => {
    const legs = [120, 300, 450];
    expect(remainingMeters(50, 1, legs)).toBe(50 + 300 + 450);
    expect(remainingMeters(50, 3, legs)).toBe(50);
  });
});
