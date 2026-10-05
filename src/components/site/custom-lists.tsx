'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { GripVertical, Link2, ListPlus, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  addToList,
  createList,
  deleteList,
  fetchListItems,
  fetchLists,
  removeFromList,
  reorderList,
  type ListMemberRow,
  type ListSummary,
} from '@/lib/library';
import { fetchWatchlist } from '@/lib/tmdb';

/** One draggable list row inside the editor dialog. */
function SortableMember({
  member,
  onRemove,
}: {
  member: ListMemberRow;
  onRemove: (tmdbId: number, mediaType: 'movie' | 'tv') => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: member.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        'flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/70 ' +
        (isDragging ? 'z-10 shadow-lg ring-2 ring-brand/40' : '')
      }
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        aria-label={`Reorder ${member.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">
        {member.title}
      </span>
      <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        {member.mediaType === 'tv' ? 'TV' : 'Movie'}
      </span>
      <button
        type="button"
        aria-label={`Remove ${member.title}`}
        onClick={() => onRemove(member.tmdbId, member.mediaType)}
        className="rounded p-1 text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

/**
 * Custom lists manager — create lists, curate titles from My List, reorder
 * with drag-and-drop, share a public read-only link.
 */
export function CustomLists() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [order, setOrder] = useState<ListMemberRow[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const listsQuery = useQuery<ListSummary[]>({
    queryKey: ['lists'],
    queryFn: fetchLists,
    staleTime: 30_000,
  });

  const listDetailQuery = useQuery<{ list: { name: string; isPublic: boolean }; items: ListMemberRow[] }>({
    queryKey: ['lists', openListId, 'items'],
    queryFn: () => fetchListItems(openListId as string),
    enabled: openListId !== null,
  });

  const watchlistQuery = useQuery({
    queryKey: ['watchlist'],
    queryFn: fetchWatchlist,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['lists'] });
    if (openListId) {
      void queryClient.invalidateQueries({ queryKey: ['lists', openListId, 'items'] });
    }
  };

  const createMutation = useMutation({
    mutationFn: () => createList(newName.trim(), false),
    onSuccess: (list) => {
      setNewName('');
      invalidate();
      toast.success(`List “${list.name}” created`);
    },
    onError: () => toast.error('Could not create the list'),
  });

  const removeMutation = useMutation({
    mutationFn: ({ tmdbId, mediaType }: { tmdbId: number; mediaType: 'movie' | 'tv' }) =>
      removeFromList(openListId as string, tmdbId, mediaType),
    onSuccess: invalidate,
  });

  const deleteListMutation = useMutation({
    mutationFn: (id: string) => deleteList(id),
    onSuccess: () => {
      setOpenListId(null);
      invalidate();
      toast.success('List deleted');
    },
  });

  const addMutation = useMutation({
    mutationFn: (item: { tmdbId: number; mediaType: 'movie' | 'tv'; title: string; posterPath: string | null }) =>
      addToList(openListId as string, item),
    onSuccess: invalidate,
    onError: () => toast.error('Could not add the title'),
  });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !openListId) return;
    const oldIndex = order.findIndex((m) => m.id === active.id);
    const newIndex = order.findIndex((m) => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    void reorderList(openListId, next.map((m) => m.id))
      .then(invalidate)
      .catch(() => toast.error('Reorder failed — try again'));
  };

  const openListDetail = (listId: string) => {
    setOpenListId(listId);
    setOrder([]);
  };

  // Keep the drag order in sync with fresh data (e.g. after add/remove).
  const detailItems = listDetailQuery.data?.items ?? [];
  const effectiveOrder =
    order.length === detailItems.length && order.every((m, i) => detailItems[i]?.id === m.id)
      ? order
      : detailItems;

  const openList = (listsQuery.data ?? []).find((l) => l.id === openListId);
  const addedIds = new Set(detailItems.map((m) => `${m.tmdbId}:${m.mediaType}`));

  return (
    <section aria-label="Custom lists" className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          <span className="size-4 rounded-full bg-brand md:h-5 md:w-1" aria-hidden />
          <ListPlus className="size-4 text-brand" aria-hidden />
          Your lists
        </h2>
        <div className="ml-auto flex min-w-52 flex-1 gap-1.5 sm:max-w-xs">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 60))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim().length >= 1 && !createMutation.isPending) {
                createMutation.mutate();
              }
            }}
            placeholder="New list name…"
            aria-label="New list name"
            className="h-9 rounded-lg border-zinc-200 bg-white/80 text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
          />
          <Button
            type="button"
            size="sm"
            disabled={newName.trim().length < 1 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            aria-label="Create list"
            className="h-9 shrink-0 rounded-lg bg-brand px-2.5 text-brand-foreground hover:bg-brand/90"
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {listsQuery.isPending ? (
        <p className="py-3 text-sm text-zinc-500">Loading lists…</p>
      ) : (listsQuery.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-5 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No custom lists yet — create one above (e.g. “Nordic noir night”) and curate it from My List.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {(listsQuery.data ?? []).map((list) => (
            <li key={list.id} className="flex items-center overflow-hidden rounded-full border border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/60">
              <button
                type="button"
                onClick={() => openListDetail(list.id)}
                className="flex items-center gap-2 py-1.5 pl-3.5 pr-2 text-sm font-medium text-zinc-700 transition-colors hover:text-brand dark:text-zinc-300"
              >
                {list.name}
                <span className="rounded-full bg-brand/10 px-1.5 text-[10px] font-bold text-brand">
                  {list.itemCount}
                </span>
              </button>
              {list.isPublic && (
                <button
                  type="button"
                  aria-label={`Copy share link for ${list.name}`}
                  title="Copy share link"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(`${window.location.origin}/?share=${list.shareToken}`)
                      .then(() => toast.success('Share link copied'))
                      .catch(() => toast.error('Could not copy the link'));
                  }}
                  className="p-1.5 text-zinc-400 hover:text-brand"
                >
                  <Link2 className="size-3.5" aria-hidden />
                </button>
              )}
              <button
                type="button"
                aria-label={`Delete ${list.name}`}
                onClick={() => {
                  if (window.confirm(`Delete the list “${list.name}”?`)) {
                    deleteListMutation.mutate(list.id);
                  }
                }}
                className="p-1.5 pr-2 text-zinc-400 hover:text-red-500"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* List editor dialog */}
      <Dialog open={openListId !== null} onOpenChange={(open) => !open && setOpenListId(null)}>
        <DialogContent className="max-w-md rounded-2xl border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              {openList?.name ?? 'List'}
              {openList && !openList.isPublic && (
                <button
                  type="button"
                  onClick={invalidate}
                  className="text-[11px] font-normal text-zinc-400"
                  title="Only you can see this list"
                >
                  (private)
                </button>
              )}
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              Drag to reorder. Titles play right from the list.
            </DialogDescription>
          </DialogHeader>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={effectiveOrder.map((m) => m.id)} strategy={verticalListSortingStrategy}>
              <ul className="max-h-80 space-y-1.5 overflow-y-auto" aria-label="List items">
                {effectiveOrder.map((member) => (
                  <SortableMember
                    key={member.id}
                    member={member}
                    onRemove={(tmdbId, mediaType) => removeMutation.mutate({ tmdbId, mediaType })}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          {effectiveOrder.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-5 text-center text-sm text-zinc-500 dark:border-zinc-800">
              This list is empty — add titles from My List below.
            </p>
          )}

          {/* Quick add from My List */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Add from My List</p>
            <ul className="max-h-36 space-y-1 overflow-y-auto">
              {(watchlistQuery.data ?? [])
                .filter((item) => !addedIds.has(`${item.tmdbId}:${item.mediaType}`))
                .map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() =>
                        addMutation.mutate({
                          tmdbId: item.tmdbId,
                          mediaType: item.mediaType,
                          title: item.title,
                          posterPath: item.posterPath,
                        })
                      }
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-brand-soft dark:text-zinc-300"
                    >
                      <Plus className="size-3.5 shrink-0 text-brand" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 text-[10px] uppercase text-zinc-400">{item.mediaType}</span>
                    </button>
                  </li>
                ))}
              {(watchlistQuery.data ?? []).filter((item) => !addedIds.has(`${item.tmdbId}:${item.mediaType}`)).length === 0 && (
                <li className="py-2 text-center text-xs text-zinc-500">Everything from My List is in here.</li>
              )}
            </ul>
          </div>

          {openList?.isPublic && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${window.location.origin}/?share=${openList.shareToken}`)
                  .then(() => toast.success('Share link copied'))
                  .catch(() => toast.error('Could not copy the link'));
              }}
              className="h-8 gap-1.5 rounded-lg border-zinc-200 text-xs dark:border-zinc-800"
            >
              <Link2 className="size-3.5" aria-hidden />
              Copy public share link
            </Button>
          )}

          <button
            type="button"
            onClick={() => setOpenListId(null)}
            aria-label="Close list editor"
            className="absolute right-3 top-3 rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <X className="size-4" aria-hidden />
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
