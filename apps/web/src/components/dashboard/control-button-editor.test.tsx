import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ControlButtonEditor } from './control-button-editor';
import { DEFAULT_CONTROL_DRAFT, type ControlButtonDraft, type ControlPresetKey } from './types';

function EditorHarness() {
  const [controlDraft, setControlDraft] = useState<ControlButtonDraft>({
    ...DEFAULT_CONTROL_DRAFT,
    label: 'Create label',
  });
  const [controlPreset, setControlPreset] = useState<ControlPresetKey>('ptz-pan');
  const [editingControlId, setEditingControlId] = useState<string | null>('control-1');
  const [controlEditDraft, setControlEditDraft] = useState<ControlButtonDraft | null>({
    ...DEFAULT_CONTROL_DRAFT,
    label: 'Edit label',
  });
  const [controlEditPreset, setControlEditPreset] = useState<ControlPresetKey>('ptz-tilt');

  return (
    <ControlButtonEditor
      controlButtons={[]}
      controlsLoading={false}
      controlDraft={controlDraft}
      setControlDraft={setControlDraft}
      controlPreset={controlPreset}
      setControlPreset={setControlPreset}
      editingControlId={editingControlId}
      controlEditDraft={controlEditDraft}
      setControlEditDraft={setControlEditDraft}
      controlEditPreset={controlEditPreset}
      setControlEditPreset={setControlEditPreset}
      setEditingControlId={setEditingControlId}
      controlOp={null}
      creatingControl={false}
      onCreateControl={vi.fn()}
      onToggleControl={vi.fn()}
      onStartEditControl={vi.fn()}
      onSaveControlEdit={vi.fn()}
      onDeleteControl={vi.fn()}
      onMoveControl={vi.fn()}
    />
  );
}

describe('ControlButtonEditor', () => {
  it('keeps create and edit drafts independent while exposing the same fields', async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);

    const labelInputs = screen.getAllByPlaceholderText('Label');
    const createLabelInput = screen.getByDisplayValue('Create label');
    const editLabelInput = screen.getByDisplayValue('Edit label');
    expect(labelInputs).toHaveLength(2);
    expect(createLabelInput).toHaveValue('Create label');
    expect(editLabelInput).toHaveValue('Edit label');
    expect(screen.getAllByPlaceholderText('Cooldown ms')).toHaveLength(2);
    expect(screen.getAllByText('Apply preset')).toHaveLength(2);

    await user.clear(createLabelInput);
    await user.type(createLabelInput, 'New control');

    expect(createLabelInput).toHaveValue('New control');
    expect(editLabelInput).toHaveValue('Edit label');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getAllByPlaceholderText('Label')).toHaveLength(1);
    expect(screen.getByPlaceholderText('Label')).toHaveValue('New control');
  });
});
