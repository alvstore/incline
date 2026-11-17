// @ts-expect-error -- Bun test types are not part of the app build
import { expect, test } from 'bun:test';
import { fitnessNotificationFields } from './fitnessNotification';

test('workout assignments keep their member workout destination', () => {
  expect(fitnessNotificationFields({ event_key: 'fitness_plan_assigned', plan_type: 'workout' }))
    .toEqual({ category: 'fitness_plan', action_url: '/my-workout' });
});
test('diet assignments keep their member diet destination', () => {
  expect(fitnessNotificationFields({ event_key: 'fitness_plan_assigned', plan_type: 'diet' }))
    .toEqual({ category: 'fitness_plan', action_url: '/my-diet' });
});
test('unrelated or malformed events do not change notification routing', () => {
  expect(fitnessNotificationFields({ event_key: 'task_assigned', plan_type: 'diet' })).toEqual({});
  expect(fitnessNotificationFields({ event_key: 'fitness_plan_assigned', plan_type: 'other' })).toEqual({});
});