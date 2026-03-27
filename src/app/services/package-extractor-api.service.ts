import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ExtractPackageRequest,
  ExtractPackageResponse,
} from '../models/package-extractor-contract.model';

@Injectable({
  providedIn: 'root',
})
export class PackageExtractorApiService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = '/api/package-extractor/extract';

  async extractPackage(request: ExtractPackageRequest): Promise<ExtractPackageResponse> {
    const formData = new FormData();
    formData.append('package', request.packageBlob, request.fileName);
    formData.append('resourceId', request.resourceId);
    formData.append('resourceKind', request.resourceKind);

    if (request.originalUrl) {
      formData.append('originalUrl', request.originalUrl);
    }

    return firstValueFrom(this.http.post<ExtractPackageResponse>(this.endpoint, formData));
  }
}
