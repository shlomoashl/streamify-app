import React, { useEffect, useState } from 'react';
import { YOUTUBE_API_BASE } from '../constants';
import { fetchEncryptedImageBlobUrl } from '../utils/encryptionUtils';

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src?: string;
    encryptionEnabled: boolean;
    fallback?: React.ReactNode;
}

export const SmartImage: React.FC<SmartImageProps> = ({
    src,
    encryptionEnabled,
    fallback = null,
    className,
    ...rest
}) => {
    const [resolvedSrc, setResolvedSrc] = useState<string>(() => {
        if (!src) return '';
        return encryptionEnabled ? '' : src;
    });
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setHasError(false);
        if (!src) {
            setResolvedSrc('');
            return;
        }

        // מסלול ללא הצפנה: URL ישיר ונקי בלי שום Base64 ובלי XOR
        if (!encryptionEnabled) {
            setResolvedSrc(src);
            return;
        }

        // מסלול מוצפן: הורדת התמונה המוצפנת מהשרת ופענוח XOR בזיכרון
        let cancelled = false;
        setResolvedSrc('');

        fetchEncryptedImageBlobUrl(YOUTUBE_API_BASE, src).then((blobUrl) => {
            if (!cancelled) {
                if (blobUrl) {
                    setResolvedSrc(blobUrl);
                } else {
                    setHasError(true);
                }
            }
        });

        return () => {
            cancelled = true;
        };
    }, [src, encryptionEnabled]);

    if (!src || hasError || !resolvedSrc) {
        return <>{fallback}</>;
    }

    return (
        <img
            src={resolvedSrc}
            className={className}
            onError={() => setHasError(true)}
            {...rest}
        />
    );
};
