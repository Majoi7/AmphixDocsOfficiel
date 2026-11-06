import { FileCard, type FileCardProps } from './FileCard';

export type DocumentCardProps = Omit<FileCardProps, 'canManage'>;

// Les deux points d'entrée partagent les mêmes contrôles, erreurs et liens signés.
export const DocumentCard = (props: DocumentCardProps) => <FileCard {...props} />;
