import { DEFAULT_CONTROL_DRAFT, DEFAULT_CREATE_FORM } from '@/components/dashboard/types';
import { useDashboardStore } from './dashboard-store';

describe('dashboard-store', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      createForm: DEFAULT_CREATE_FORM,
      selectedId: null,
      editForm: DEFAULT_CREATE_FORM,
      showToken: true,
      controlDraft: DEFAULT_CONTROL_DRAFT,
      controlPreset: 'ptz-pan',
      editingControlId: null,
      controlEditDraft: null,
      controlEditPreset: 'ptz-pan',
      allowlistUsername: '',
      newIngressCameraId: '',
      newIngressLabel: '',
      newIngressCompatibilityMode: false,
      obsHelpOpen: false,
      activeSectionId: 'section-settings',
    });
  });

  it('updates and resets editor-facing dashboard state', () => {
    const store = useDashboardStore.getState();

    store.setCreateForm((prev) => ({ ...prev, name: 'Mars Rover' }));
    store.setSelectedId('robot-1');
    store.setEditForm((prev) => ({ ...prev, slug: 'mars-rover' }));
    store.setShowToken(false);
    store.setControlDraft((prev) => ({ ...prev, label: 'Forward' }));
    store.setAllowlistUsername('julien');
    store.setNewIngressCameraId('front');
    store.setNewIngressLabel('Front camera');
    store.setNewIngressCompatibilityMode(true);
    store.setObsHelpOpen(true);
    store.setActiveSectionId('section-controls');

    expect(useDashboardStore.getState().createForm.name).toBe('Mars Rover');
    expect(useDashboardStore.getState().selectedId).toBe('robot-1');
    expect(useDashboardStore.getState().editForm.slug).toBe('mars-rover');
    expect(useDashboardStore.getState().showToken).toBe(false);
    expect(useDashboardStore.getState().controlDraft.label).toBe('Forward');
    expect(useDashboardStore.getState().allowlistUsername).toBe('julien');
    expect(useDashboardStore.getState().newIngressCameraId).toBe('front');
    expect(useDashboardStore.getState().newIngressLabel).toBe('Front camera');
    expect(useDashboardStore.getState().newIngressCompatibilityMode).toBe(true);
    expect(useDashboardStore.getState().obsHelpOpen).toBe(true);
    expect(useDashboardStore.getState().activeSectionId).toBe('section-controls');

    useDashboardStore.getState().resetCreateForm();
    useDashboardStore.getState().resetControlDraft();
    useDashboardStore.getState().resetAllowlistUsername();
    useDashboardStore.getState().resetIngressDraft();

    expect(useDashboardStore.getState().createForm).toEqual(DEFAULT_CREATE_FORM);
    expect(useDashboardStore.getState().controlDraft).toEqual(DEFAULT_CONTROL_DRAFT);
    expect(useDashboardStore.getState().allowlistUsername).toBe('');
    expect(useDashboardStore.getState().newIngressCameraId).toBe('');
    expect(useDashboardStore.getState().newIngressLabel).toBe('');
    expect(useDashboardStore.getState().newIngressCompatibilityMode).toBe(false);
  });
});
