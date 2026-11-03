import type { PersonRoleT, PlaceCategoryT } from './content/schema';

export const CATEGORY: Record<PlaceCategoryT, string> = {
  architecture: 'Архитектура',
  religion: 'Храмы и мечети',
  history: 'История',
  monument: 'Памятники и скульптура',
  museum: 'Музеи',
  'public-space': 'Площади и улицы',
  nature: 'Природа',
};

export const ROLE: Record<PersonRoleT, string> = {
  architect: 'Архитектор',
  sculptor: 'Скульптор',
  artist: 'Художник',
  engineer: 'Инженер',
  customer: 'Заказчик',
  founder: 'Основатель',
  subject: 'Посвящён',
};

export const HERITAGE = {
  federal: 'Объект культурного наследия федерального значения',
  regional: 'Объект культурного наследия регионального значения',
  local: 'Объект культурного наследия местного значения',
  identified: 'Выявленный объект культурного наследия',
} as const;
