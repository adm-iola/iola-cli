import argparse
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def check_deps():
    import torch  # noqa: F401
    import transformers  # noqa: F401
    import peft  # noqa: F401
    import huggingface_hub  # noqa: F401
    import hf_xet  # noqa: F401


def load_payload():
    raw = sys.stdin.buffer.read().decode("utf-8").strip()
    if not raw:
        return {}
    return json.loads(raw)


def model_revision(repo, token):
    from huggingface_hub import HfApi

    try:
        info = HfApi(token=token).model_info(repo)
        return getattr(info, "sha", "") or ""
    except Exception:
        return ""


def load_model(repo, cache_dir, token):
    import torch
    from peft import PeftConfig, PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    peft_config = None
    base_model = repo
    try:
        peft_config = PeftConfig.from_pretrained(repo, cache_dir=cache_dir, token=token)
        base_model = peft_config.base_model_name_or_path
    except Exception:
        peft_config = None

    tokenizer = AutoTokenizer.from_pretrained(base_model, cache_dir=cache_dir, token=token)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    dtype = torch.float16 if torch.cuda.is_available() else (torch.bfloat16 if peft_config is not None else torch.float32)
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        cache_dir=cache_dir,
        token=token,
        torch_dtype=dtype,
        device_map="auto" if torch.cuda.is_available() else None,
        attn_implementation="sdpa",
    )
    if peft_config is not None:
        model = PeftModel.from_pretrained(model, repo, cache_dir=cache_dir, token=token)
        model = model.merge_and_unload()

    model.eval()
    return tokenizer, model


def ensure_model(payload):
    repo = payload.get("repo") or os.environ.get("IOLA_ROUTER_HF_REPO") or "LMSerg/iola-1b-router-2026-05-28-merged"
    cache_dir = payload.get("cache_dir") or os.environ.get("IOLA_MODEL_DIR")
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)

    tokenizer, model = load_model(repo, cache_dir, token)
    del tokenizer
    del model
    print(json.dumps({"repo": repo, "revision": model_revision(repo, token)}, ensure_ascii=False))


def generate(payload):
    repo = payload.get("repo") or os.environ.get("IOLA_ROUTER_HF_REPO") or "LMSerg/iola-1b-router-2026-05-28-merged"
    cache_dir = payload.get("cache_dir") or os.environ.get("IOLA_MODEL_DIR")
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    messages = payload.get("messages") or []
    max_new_tokens = int(payload.get("max_new_tokens") or 180)
    temperature = float(payload.get("temperature") or 0)

    tokenizer, model = load_model(repo, cache_dir, token)
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    encoded = tokenizer(prompt, return_tensors="pt").to(model.device)

    generate_kwargs = {
        **encoded,
        "max_new_tokens": max_new_tokens,
        "do_sample": temperature > 0,
        "pad_token_id": tokenizer.pad_token_id,
        "eos_token_id": tokenizer.eos_token_id,
    }
    if temperature > 0:
        generate_kwargs["temperature"] = temperature

    import torch

    with torch.no_grad():
        output = model.generate(**generate_kwargs)

    answer_ids = output[0][encoded["input_ids"].shape[1]:]
    answer = tokenizer.decode(answer_ids, skip_special_tokens=True).strip()
    print(answer)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-deps", action="store_true")
    parser.add_argument("--ensure", action="store_true")
    args = parser.parse_args()

    if args.check_deps:
        check_deps()
        print("ok")
        return

    payload = load_payload()
    if args.ensure:
        ensure_model(payload)
        return

    generate(payload)


if __name__ == "__main__":
    main()
