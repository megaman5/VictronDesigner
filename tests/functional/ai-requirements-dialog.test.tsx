import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AIPromptDialog } from '../../client/src/components/AIPromptDialog';

describe('AI prompt entry', () => {
  it('submits equipment requests directly from the prompt without a checklist', () => {
    const onGenerate = vi.fn();
    render(<AIPromptDialog open onOpenChange={() => {}} onGenerate={onGenerate} />);
    fireEvent.change(screen.getByTestId('input-ai-prompt'), { target: { value: '2 batteries and solar panel' } });
    expect(screen.queryByTestId('ai-requirements-checklist')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-generate-ai'));
    expect(onGenerate.mock.calls).toEqual([['2 batteries and solar panel']]);
  });
  it('allows an example prompt to be submitted without extra steps', () => {
    const onGenerate = vi.fn();
    render(<AIPromptDialog open onOpenChange={() => {}} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByTestId('example-prompt-0'));
    fireEvent.click(screen.getByTestId('button-generate-ai'));
    expect(onGenerate.mock.calls).toEqual([['Design a 3kW solar system for an RV with 400Ah battery bank']]);
  });
  it('submits optional capacity and parallel conductor requirements for separate checks', () => {
    const onGenerate = vi.fn();
    render(<AIPromptDialog open onOpenChange={() => {}} onGenerate={onGenerate} systemVoltage={24} existingComponents={[{ id: 'f', name: 'Fuse', type: 'fuse' }, { id: 'bus', name: 'Bus', type: 'busbar-positive' }]} />);
    fireEvent.change(screen.getByTestId('input-ai-prompt'), { target: { value: 'Wire my system' } });
    fireEvent.change(screen.getByLabelText('Minimum solar watts'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('Battery bank Ah at system voltage'), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText('Required connection source'), { target: { value: 'f' } });
    fireEvent.change(screen.getByLabelText('Required connection destination'), { target: { value: 'bus' } });
    fireEvent.change(screen.getByLabelText('Required conductor count'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('button-generate-ai'));
    expect(onGenerate.mock.calls[0][1]).toMatchObject({ dcVoltage: 24, aggregates: expect.arrayContaining([expect.objectContaining({ type: 'battery', minimum: 400 }), expect.objectContaining({ type: 'solar-panel', minimum: 3000 })]), connections: [expect.objectContaining({ fromComponentId: 'f', toComponentId: 'bus', minimumWires: 2 })] });
  });

});
