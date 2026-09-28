export function getCollaboratorColor(value: string) {
  const colors = ["#8ee7ff", "#6ee7b7", "#fbbf24", "#fda4af", "#c4b5fd", "#93c5fd"];
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return colors[Math.abs(hash) % colors.length];
}
