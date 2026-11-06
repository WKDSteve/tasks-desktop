// The floats of this app: the kit's action (`appkit-ui/floating`), with its places kept under the key they always had.
import { floatingIn, type FloatingParams } from 'appkit-ui/floating';

export type { FloatingParams };

export const floating = floatingIn('tasks-desktop.floats');
