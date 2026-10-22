// The hidden file input behind "Add files", "Choose files" and "Add your own files": the media bin
// draws it, and any of those buttons opens it.

let input: HTMLInputElement | null = null;

/** The media bin calls this with its file input, and with null when it goes away. */
export function registerFilePicker(element: HTMLInputElement | null): void {
  input = element;
}

/** Opens the browser's file picker. */
export function chooseFiles(): void {
  input?.click();
}
