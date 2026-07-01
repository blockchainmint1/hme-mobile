import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CHAIN_META,
  getEnabledChains,
  setChainOrder,
  type ChainId,
} from "@/lib/chain-prefs";

/**
 * Bottom-sheet overlay for reordering the enabled chain tiles.
 * Triggered by a long-press anywhere on a tile in the carousel.
 */
export function ReorderTilesSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ChainId[]>([]);

  useEffect(() => {
    if (open) setItems(getEnabledChains());
  }, [open]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((cur) => {
      const oldIndex = cur.indexOf(active.id as ChainId);
      const newIndex = cur.indexOf(over.id as ChainId);
      if (oldIndex < 0 || newIndex < 0) return cur;
      return arrayMove(cur, oldIndex, newIndex);
    });
  }

  function save() {
    setChainOrder(items);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-card text-card-foreground p-4 pb-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">Rearrange wallets</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Drag to reorder. Only enabled chains are shown.
        </p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {items.map((id) => (
                <SortableRow key={id} id={id} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        <div className="mt-4 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function SortableRow({ id }: { id: ChainId }) {
  const meta = CHAIN_META[id];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: `linear-gradient(135deg, ${meta.accent} 0%, ${meta.accent}CC 60%, #111 160%)`,
    opacity: isDragging ? 0.85 : 1,
    touchAction: "none",
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-3 px-3 py-3 rounded-xl text-white shadow select-none"
    >
      <GripVertical className="h-5 w-5 opacity-80" />
      <span className="font-semibold flex-1">{meta.name}</span>
      <span className="text-xs opacity-80">{meta.shortName}</span>
    </li>
  );
}
