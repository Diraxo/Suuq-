import Constants, { ExecutionEnvironment } from 'expo-constants';

// Expo Go can't complete a real OAuth redirect back into the app.
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
