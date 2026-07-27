import AsyncStorage from '@react-native-async-storage/async-storage';

import { LibraryState, createInitialLibrary } from './core';

const storageKey = 'syria-tube:library:v1';

export async function loadLibrary(): Promise<LibraryState> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) {
    return createInitialLibrary();
  }
  const parsed = JSON.parse(raw) as Partial<LibraryState>;
  return {
    ...createInitialLibrary(),
    ...parsed,
    savedVideos: parsed.savedVideos ?? {},
    watchLaterIds: parsed.watchLaterIds ?? [],
    favouriteIds: parsed.favouriteIds ?? [],
    history: parsed.history ?? [],
    collections: parsed.collections ?? createInitialLibrary().collections,
    recentSearches: parsed.recentSearches ?? []
  };
}

export async function saveLibrary(library: LibraryState): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(library));
}

export async function clearLibrary(): Promise<void> {
  await AsyncStorage.removeItem(storageKey);
}
