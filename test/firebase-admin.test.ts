import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCert,
  mockGetApps,
  mockInitializeApp,
  mockGetDatabaseService,
  mockLoadConfig
} = vi.hoisted(() => ({
  mockCert: vi.fn(),
  mockGetApps: vi.fn(),
  mockInitializeApp: vi.fn(),
  mockGetDatabaseService: vi.fn(),
  mockLoadConfig: vi.fn()
}));

vi.mock('firebase-admin/app', () => ({
  cert: mockCert,
  getApps: mockGetApps,
  initializeApp: mockInitializeApp
}));

vi.mock('firebase-admin/database', () => ({
  getDatabase: mockGetDatabaseService
}));

vi.mock('../src/config.js', () => ({
  loadConfig: mockLoadConfig
}));

describe('Firebase Admin initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLoadConfig.mockReturnValue({
      firebaseProjectId: 'demo-project',
      firebaseClientEmail: 'firebase@example.com',
      firebasePrivateKey: 'private-key',
      firebaseDatabaseUrl: 'https://demo.firebaseio.com'
    });
    mockCert.mockReturnValue('credential');
  });

  it('initializes the Admin app once and creates the database service from it', async () => {
    const adminApp = { name: 'admin-app' };
    const database = { ref: vi.fn() };
    mockGetApps.mockReturnValue([]);
    mockInitializeApp.mockReturnValue(adminApp);
    mockGetDatabaseService.mockReturnValue(database);

    const { getDatabase, getFirebaseAdmin } = await import('../src/firebase-admin.js');

    expect(getDatabase()).toBe(database);
    expect(getFirebaseAdmin()).toBe(adminApp);
    expect(mockCert).toHaveBeenCalledWith({
      projectId: 'demo-project',
      clientEmail: 'firebase@example.com',
      privateKey: 'private-key'
    });
    expect(mockInitializeApp).toHaveBeenCalledOnce();
    expect(mockInitializeApp).toHaveBeenCalledWith({
      credential: 'credential',
      databaseURL: 'https://demo.firebaseio.com'
    });
    expect(mockGetDatabaseService).toHaveBeenCalledWith(adminApp);
  });

  it('reuses an existing Admin app', async () => {
    const existingApp = { name: 'existing-app' };
    mockGetApps.mockReturnValue([existingApp]);

    const { getFirebaseAdmin } = await import('../src/firebase-admin.js');

    expect(getFirebaseAdmin()).toBe(existingApp);
    expect(mockInitializeApp).not.toHaveBeenCalled();
    expect(mockCert).not.toHaveBeenCalled();
  });
});
