import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n";
import { getClipboardImageFile } from "../lib/clipboardImage";
import type { AssetItem } from "../types";

type PasteAssetResult = {
  asset: AssetItem;
  uploaded: boolean;
  origin: ComposerImageOrigin;
  uploadFallback?: boolean;
};

export type ComposerImageOrigin = "pasted" | "drawing";
type AddComposerImageOptions = {
  replaceAssetId?: string;
};
type ComposerImageMutationInput = AddComposerImageOptions & {
  file: File;
  origin: ComposerImageOrigin;
};

const MAX_INLINE_COMPOSER_IMAGES = 8;

type UseComposerPasteAssetOptions = {
  autoUploadPastedAssets: boolean;
  selectedAssets: AssetItem[];
  setSelectedAssets: (assets: AssetItem[]) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

function readFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function temporaryAssetFromFile(file: File): Promise<AssetItem> {
  const dataUrl = await readFileDataUrl(file);
  const timestamp = new Date().toISOString();
  return {
    id: `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    space: "private",
    name: file.name || "粘贴图片",
    url: dataUrl,
    originalUrl: dataUrl,
    previewUrl: dataUrl,
    thumbnailUrl: dataUrl,
    mimeType: file.type || "image/png",
    size: file.size,
    imageWidth: 0,
    imageHeight: 0,
    createdAt: timestamp,
    sourceUsername: "本次输入",
    canEdit: false,
    shared: false,
    shareStatus: "none",
    categoryIds: [],
    categoryNames: [],
    temporary: true,
    dataUrl
  };
}

export function useComposerPasteAsset({ autoUploadPastedAssets, selectedAssets, setSelectedAssets, showToast }: UseComposerPasteAssetOptions) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const pasteAsset = useMutation({
    mutationFn: async ({ file, origin }: ComposerImageMutationInput): Promise<PasteAssetResult> => {
      if (!autoUploadPastedAssets) {
        return { asset: await temporaryAssetFromFile(file), uploaded: false, origin };
      }
      const form = new FormData();
      form.set("file", file);
      try {
        const result = await api.uploadAsset(form);
        return { asset: result.asset, uploaded: true, origin };
      } catch (error) {
        if (origin !== "drawing") throw error;
        const inlineCount = selectedAssets.filter((asset) => asset.temporary || asset.dataUrl).length;
        if (inlineCount >= MAX_INLINE_COMPOSER_IMAGES) {
          throw new Error(t("drawing.error.inlineLimit", { count: MAX_INLINE_COMPOSER_IMAGES }));
        }
        return {
          asset: await temporaryAssetFromFile(file),
          uploaded: false,
          origin,
          uploadFallback: true
        };
      }
    },
    onSuccess: (result, input) => {
      const replaceIndex = input.replaceAssetId
        ? selectedAssets.findIndex((asset) => asset.id === input.replaceAssetId)
        : -1;
      const remainingAssets = selectedAssets.filter((asset) => (
        asset.id !== input.replaceAssetId && asset.id !== result.asset.id
      ));
      const nextAssets = replaceIndex >= 0
        ? [
            ...remainingAssets.slice(0, Math.min(replaceIndex, remainingAssets.length)),
            result.asset,
            ...remainingAssets.slice(Math.min(replaceIndex, remainingAssets.length))
          ]
        : selectedAssets.some((asset) => asset.id === result.asset.id)
          ? selectedAssets
          : [...selectedAssets, result.asset];
      setSelectedAssets(nextAssets);
      if (result.uploaded) {
        queryClient.invalidateQueries({ queryKey: ["assets"] });
      }
      if (result.origin === "drawing") {
        showToast(
          result.uploadFallback ? t("toast.drawingImageAddedFallback") : t("toast.drawingImageAdded"),
          result.uploadFallback ? "info" : "success"
        );
      } else {
        showToast(t("toast.pastedImageAdded"));
      }
    },
    onError: (err, input) => {
      showToast(
        err instanceof ApiError
          ? err.message
          : input.origin === "drawing"
            ? t("toast.drawingImageFailed")
            : t("toast.pastedImageFailed"),
        "error"
      );
    }
  });

  const addComposerImage = async (file: File, origin: ComposerImageOrigin, options: AddComposerImageOptions = {}) => {
    if (origin === "drawing" && !autoUploadPastedAssets) {
      const inlineCount = selectedAssets.filter((asset) => asset.temporary || asset.dataUrl).length;
      if (inlineCount >= MAX_INLINE_COMPOSER_IMAGES) {
        throw new Error(t("drawing.error.inlineLimit", { count: MAX_INLINE_COMPOSER_IMAGES }));
      }
    }
    return pasteAsset.mutateAsync({ file, origin, ...options });
  };

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const imageFile = getClipboardImageFile(event.clipboardData);
    if (!imageFile) return;
    event.preventDefault();
    if (pasteAsset.isPending) {
      showToast(t("toast.pastedImageAdding"));
      return;
    }
    pasteAsset.mutate({ file: imageFile, origin: "pasted" });
  };

  return { addComposerImage, handleComposerPaste, isPastingAsset: pasteAsset.isPending };
}
