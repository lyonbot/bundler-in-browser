import { useEditorStore, type FileTreeNode } from '@/store/editor';
import { computed, defineComponent, reactive, watch, type PropType } from 'vue';

export default defineComponent({
  name: 'FileTree',
  setup() {
    const store = useEditorStore();
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
      <ul>
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
    const isExpanded = computed({
      get: () => props.ctx.expandedFiles.has(props.item.path),
      set: (v) => {
        const set = props.ctx.expandedFiles;
        const path = props.item.path;
        if (v) set.add(path);
        else set.delete(path);
      }
    })

    const isDirectory = computed(() => !!props.item.children);

    return () => (
      <li>
        <div onClick={() => {
          if (!isDirectory.value) return;
          isExpanded.value = !isExpanded.value
        }}
          title={props.item.path}>
          {props.item.name}
        </div>
        {
          isExpanded.value && isDirectory.value && <ul>
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