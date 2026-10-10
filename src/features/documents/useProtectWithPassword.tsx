import { useRef, useState } from "react";

import { useProtectDocument } from "@/features/contracts/queries";
import { notify } from "@/lib/dialog";

import { PdfPasswordModal } from "./PdfPasswordForm";

type Regions = { id: string; state: "masked" | "unmasked" }[];

/**
 * 보호 처리·가림 변경 — 암호 PDF면 비밀번호를 받아 다시 요청한다 (계약 상세·확인 화면).
 * 비밀번호는 이 요청에만 쓰고 기억하지 않는다 (다음에 또 필요하면 다시 묻는다).
 */
export function useProtectWithPassword() {
  const protect = useProtectDocument();
  const pending = useRef<{ documentId: string; regions?: Regions } | null>(
    null,
  );
  const [ask, setAsk] = useState<{ invalid: boolean } | null>(null);

  const send = (
    documentId: string,
    regions: Regions | undefined,
    password?: string,
  ) =>
    protect.mutate(
      { documentId, regions, password },
      {
        onSuccess: (r) => {
          // 보호 처리 없이 비밀번호만 요청한 응답 (pending). 보호가 끝난 암호 원본도 access는 password_required로 온다
          if (
            r.status === "pending" &&
            (r.access === "password_required" ||
              r.access === "invalid_password")
          ) {
            pending.current = { documentId, regions };
            setAsk({ invalid: !!password });
            return;
          }
          pending.current = null;
          setAsk(null);
        },
        onError: () =>
          notify(
            "민감정보 보호",
            "처리하지 못했어요. 잠시 후 다시 시도해주세요.",
          ),
      },
    );

  const modal = (
    <PdfPasswordModal
      visible={ask !== null}
      invalid={ask?.invalid}
      busy={protect.isPending}
      submitLabel="확인"
      onSubmit={(pw) =>
        pending.current &&
        send(pending.current.documentId, pending.current.regions, pw)
      }
      onCancel={() => {
        pending.current = null;
        setAsk(null);
      }}
    />
  );
  return {
    run: (documentId: string, regions?: Regions) => send(documentId, regions),
    isPending: protect.isPending,
    modal,
  };
}
