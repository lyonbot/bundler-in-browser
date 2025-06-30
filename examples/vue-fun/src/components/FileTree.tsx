import { useFileEditorStore, type FileTreeNode } from '@/store/fileEditor';
import { computed, defineComponent, reactive, watch, type PropType } from 'vue';

export default defineComponent({
  name: 'FileTree',
  setup() {
    const store = useFileEditorStore();
    const ctx: Ctx = reactive({
      expandedFiles: new Set<string>()
    });

    watch(() => store.activeFilePath, (v) => {
      // auto expand to directory
      let i = 0
      while ((i = v.indexOf('/', i + 1)) !== -1) {
        ctx.expandedFiles.add(v.slice(0, i))
      }
    })

    return () => (
      <ul class="space-y-1 text-sm">
        {store.files.map(item => (
          <TreeNode
            key={item.path}
            item={item}
            ctx={ctx}
          />
        ))}
      </ul>
    )
  }
})

interface Ctx {
  expandedFiles: Set<string>
}

const TreeNode = defineComponent({
  name: 'FileTreeNode',
  props: {
    item: { type: Object as PropType<FileTreeNode>, required: true },
    ctx: { type: Object as PropType<Ctx>, required: true }
  },
  setup(props) {
    const store = useFileEditorStore();
    const path = computed(() => props.item.path);
    const isActive = computed(() => store.activeFilePath === path.value);
    const isExpanded = computed({
      get: () => props.ctx.expandedFiles.has(path.value),
      set: (v) => {
        const set = props.ctx.expandedFiles;
        if (v) set.add(path.value);
        else set.delete(path.value);
      }
    })

    const isDirectory = computed(() => !!props.item.children);

    return () => (
      <li class="relative" style={`list-style-type: ${ isDirectory.value ? (isExpanded.value ? '"[-]"' : '"[+]"') : "disc"}`}>
        <div
          onClick={() => {
            if (isDirectory.value) {
              isExpanded.value = !isExpanded.value
            } else {
              store.openFile(path.value)
            }
          }}
          class={`flex items-center px-2 py-1 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 ${!isDirectory.value && 'hover:text-blue-500'} ${isActive.value && 'font-bold'}`}
          title={path.value}>
          <span class="truncate">{props.item.name}</span>
        </div>
        {
          isExpanded.value && isDirectory.value && <ul class="pl-4 space-y-1">
            {props.item.children!.map(child => (
              <TreeNode
                key={child.path}
                item={child}
                ctx={props.ctx}
              />
            ))}
          </ul>
        }
      </li>
    )
  }
})